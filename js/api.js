// Cliente de la API pública de cmpf-tools.de (proyecto campfire-tools de topi314).
// Solo usa GET /api/events?events=<link o ID>, con un pedido por evento:
// si se mandan varios juntos y uno falla, la API responde error para todos.

import { cleanText } from './text.js';

export const API_BASE = 'https://cmpf-tools.de';
export const DEFAULT_TIMEOUT_MS = 15000;
// Tope defensivo: un evento real tiene decenas o cientos de miembros.
export const MAX_MEMBERS = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const API_ERRORS = {
  timeout: { message: 'cmpf-tools.de tardó demasiado en responder.', suggestManual: true },
  network: { message: 'No se pudo conectar con cmpf-tools.de. Revisá tu conexión.', suggestManual: true },
  notFound: { message: 'No se encontró el evento. Revisá el link (también puede ser un evento privado).', suggestManual: false },
  invalidLink: { message: 'La API no reconoció el link del evento.', suggestManual: false },
  badRequest: { message: 'Faltó indicar el evento.', suggestManual: false },
  rateLimited: { message: 'Demasiados pedidos seguidos. Esperá un minuto y probá de nuevo.', suggestManual: true },
  server: { message: 'cmpf-tools.de respondió con un error.', suggestManual: true },
  badResponse: { message: 'cmpf-tools.de respondió algo inesperado.', suggestManual: true },
  aborted: { message: 'Se canceló la búsqueda.', suggestManual: false },
};

export class ApiError extends Error {
  constructor(code, { status = null, detail = '' } = {}) {
    super(API_ERRORS[code].message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail; // texto crudo de la API, solo para depurar (no se muestra como HTML)
    this.suggestManual = API_ERRORS[code].suggestManual;
  }
}

function normalizePerson(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    id: typeof p.id === 'string' ? p.id : '',
    username: cleanText(p.username),
    display_name: cleanText(p.display_name),
  };
}

// Nos quedamos solo con los campos que usa la app (sin avatares, coordenadas, etc.).
export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) {
    throw new ApiError('badResponse', { detail: 'evento sin id' });
  }
  const members = Array.isArray(raw.members) ? raw.members : [];
  return {
    id: raw.id,
    name: cleanText(raw.name, 120) || '(evento sin nombre)',
    // Armamos el link nosotros a partir del ID en vez de confiar en el campo url.
    url: UUID_RE.test(raw.id) ? `https://campfire.scopely.com/discover/meetup/${raw.id.toLowerCase()}` : '',
    time: typeof raw.time === 'string' ? raw.time : '',
    creator: normalizePerson(raw.creator),
    members: members
      .slice(0, MAX_MEMBERS)
      .filter((m) => m && typeof m.id === 'string' && m.id)
      .map((m) => ({
        ...normalizePerson(m),
        rsvp_status: typeof m.rsvp_status === 'string' ? m.rsvp_status.toUpperCase() : '',
      })),
  };
}

function errorFromStatus(status, body) {
  if (status === 400) return new ApiError('badRequest', { status, detail: body });
  if (status === 429) return new ApiError('rateLimited', { status, detail: body });
  // La API responde 500 con texto plano; distinguimos los dos casos verificados.
  if (status === 500 && /invalid event URL/i.test(body)) return new ApiError('invalidLink', { status, detail: body });
  if (status === 500 && /row not found/i.test(body)) return new ApiError('notFound', { status, detail: body });
  return new ApiError('server', { status, detail: body });
}

/**
 * Trae un evento. `query` es un UUID o un link corto https://cmpf.re/... ya validado.
 * @returns {Promise<ReturnType<typeof normalizeEvent>>}
 */
export async function fetchEvent(query, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  if (signal?.aborted) throw new ApiError('aborted');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  const url = `${API_BASE}/api/events?events=${encodeURIComponent(query)}`;
  try {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      if (timedOut) throw new ApiError('timeout');
      if (controller.signal.aborted) throw new ApiError('aborted');
      throw new ApiError('network', { detail: String(err?.message ?? err) });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw errorFromStatus(res.status, body.slice(0, 500));
    }

    let data;
    try {
      data = await res.json();
    } catch {
      if (timedOut) throw new ApiError('timeout');
      throw new ApiError('badResponse', { status: res.status, detail: 'JSON inválido' });
    }
    if (!Array.isArray(data)) throw new ApiError('badResponse', { status: res.status, detail: 'no es un array' });
    if (data.length === 0) throw new ApiError('notFound', { status: res.status });
    return normalizeEvent(data[0]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Trae varios eventos en paralelo, uno por pedido, para saber cuál falló.
 * @param {{input: string, query: string}[]} items  salida de parseEventInput().events
 * @returns {Promise<{events: object[], failures: {input: string, error: ApiError}[], repeated: string[]}>}
 */
export async function fetchEvents(items, options = {}) {
  const results = await Promise.allSettled(items.map((item) => fetchEvent(item.query, options)));
  const events = [];
  const failures = [];
  const repeated = []; // p. ej. un link corto y un UUID que resultan ser el mismo evento
  const seen = new Set();

  results.forEach((result, i) => {
    const { input } = items[i];
    if (result.status === 'rejected') {
      const error = result.reason instanceof ApiError
        ? result.reason
        : new ApiError('badResponse', { detail: String(result.reason?.message ?? result.reason) });
      failures.push({ input, error });
    } else if (seen.has(result.value.id)) {
      repeated.push(input);
    } else {
      seen.add(result.value.id);
      events.push(result.value);
    }
  });

  return { events, failures, repeated };
}
