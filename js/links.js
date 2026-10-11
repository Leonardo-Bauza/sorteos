// Parseo y validación de links de eventos de Campfire.
// Solo se aceptan los orígenes que la API de cmpf-tools.de reconoce
// (verificado en su mensaje de error) o un UUID de evento suelto.

export const MAX_EVENTS = 10;
const MAX_TOKEN_LENGTH = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

// host -> prefijo de ruta que precede al UUID
const MEETUP_HOSTS = {
  'campfire.nianticlabs.com': '/discover/meetup/',
  'campfire.scopely.com': '/discover/meetup/',
  'niantic-social.nianticlabs.com': '/public/meetup/',
};
const SHORT_HOST = 'cmpf.re';
const KNOWN_HOSTS = [...Object.keys(MEETUP_HOSTS), SHORT_HOST];

export const REASONS = {
  notLink: 'No es un link de Campfire ni un ID de evento.',
  otherSite: 'Solo se aceptan links de Campfire (campfire.nianticlabs.com, campfire.scopely.com o cmpf.re).',
  notEvent: 'Es un link de Campfire, pero no apunta a un evento.',
  tooLong: 'El texto es demasiado largo para ser un link de evento.',
};

// Quita comillas, paréntesis y puntuación que suele quedar pegada al copiar un link.
function stripWrapping(token) {
  return token.replace(/^[<(["'`“”‘’]+/, '').replace(/[>)\]"'`“”‘’.,;:!?]+$/, '');
}

/**
 * Interpreta un único link o UUID.
 * @returns {{ok: true, kind: 'uuid'|'short', key: string, query: string} | {ok: false, reason: string}}
 */
export function parseEventToken(raw) {
  const token = stripWrapping(String(raw).trim());
  if (!token) return { ok: false, reason: REASONS.notLink };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: REASONS.tooLong };

  if (UUID_RE.test(token)) {
    const id = token.toLowerCase();
    return { ok: true, kind: 'uuid', key: id, query: id };
  }

  // Se tolera que falte "https://" (pasa mucho al copiar de WhatsApp).
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(token) ? token : `https://${token}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: REASONS.notLink };
  }

  const isWeb = url.protocol === 'https:' || url.protocol === 'http:';
  if (!isWeb || url.username || url.password || url.port) {
    return { ok: false, reason: KNOWN_HOSTS.includes(url.hostname) ? REASONS.notEvent : REASONS.otherSite };
  }
  if (!KNOWN_HOSTS.includes(url.hostname)) {
    // Un texto suelto ("hola") termina siendo https://hola/: eso no es "otro sitio".
    return { ok: false, reason: url.hostname.includes('.') ? REASONS.otherSite : REASONS.notLink };
  }

  const path = url.pathname.replace(/\/+$/, '');

  if (url.hostname === SHORT_HOST) {
    const code = path.slice(1);
    if (!SHORT_CODE_RE.test(code)) return { ok: false, reason: REASONS.notEvent };
    // El link corto no se puede resolver desde el navegador sin otra llamada:
    // se lo mandamos tal cual a la API, que lo resuelve.
    const normalized = `https://${SHORT_HOST}/${code}`;
    return { ok: true, kind: 'short', key: normalized, query: normalized };
  }

  const prefix = MEETUP_HOSTS[url.hostname];
  if (!path.startsWith(prefix)) return { ok: false, reason: REASONS.notEvent };
  const id = path.slice(prefix.length);
  if (!UUID_RE.test(id)) return { ok: false, reason: REASONS.notEvent };
  return { ok: true, kind: 'uuid', key: id.toLowerCase(), query: id.toLowerCase() };
}

/**
 * Interpreta un texto con uno o varios links/UUIDs separados por espacios,
 * saltos de línea, comas o punto y coma.
 */
export function parseEventInput(text) {
  const tokens = String(text ?? '').split(/[\s,;]+/).filter(Boolean);
  const events = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();

  for (const input of tokens) {
    const parsed = parseEventToken(input);
    if (!parsed.ok) {
      invalid.push({ input, reason: parsed.reason });
    } else if (seen.has(parsed.key)) {
      duplicates.push(input);
    } else {
      seen.add(parsed.key);
      events.push({ input, kind: parsed.kind, key: parsed.key, query: parsed.query });
    }
  }

  return { events, invalid, duplicates, withinLimit: events.length <= MAX_EVENTS };
}
