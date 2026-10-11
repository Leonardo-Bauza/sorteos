// Datos de auditoría del sorteo y texto listo para pegar en WhatsApp/Discord.
// Todo se arma en el navegador; nada se manda a ningún servidor.

import { REASON_LABELS } from './participants.js';

export const TIME_ZONE = 'America/Argentina/Buenos_Aires';
const MEDALS = ['🥇', '🥈', '🥉'];

export function formatDateTime(iso, timeZone = TIME_ZONE) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-AR', {
    timeZone, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

/**
 * Huella SHA-256 de la lista cerrada: si alguien vuelve a cerrar la misma
 * lista obtiene el mismo código; si cambió una sola persona, cambia.
 * @returns {Promise<string|null>} hex completo, o null si el navegador no tiene crypto.subtle
 */
export async function listFingerprint(pool) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const canonical = JSON.stringify([...pool].map((p) => [p.key, p.name]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {object} p
 * @param {object[]} p.events       eventos normalizados usados ([] en modo manual)
 * @param {object} p.closed         salida de closeList().closed
 * @param {object} p.draw           estado del sorteo (raffle.js)
 * @param {'oneByOne'|'all'} p.mode cómo se reveló
 * @param {string|null} [p.fingerprint]
 */
export function buildAudit({ events = [], closed, draw, mode, fingerprint = null, now = new Date() }) {
  return {
    generatedAt: now.toISOString(),
    source: closed.source,
    events: events.map(({ id, name, url, time }) => ({ id, name, url, time })),
    filters: { ...closed.filters },
    list: {
      closedAt: closed.closedAt,
      fingerprint,
      participants: closed.pool.length,
      participantNames: closed.pool.map((p) => p.name),
      excludedByReason: { ...closed.excludedByReason },
      removedNames: [...closed.removedNames],
      ignoredNameless: closed.ignoredNameless,
    },
    draw: {
      mode,
      attempt: draw.attempt,
      startedAt: draw.startedAt,
      prizes: draw.config.winners,
      alternatesRequested: draw.config.requestedAlternates,
      alternates: draw.config.alternates,
      order: draw.log
        .filter((e) => e.type === 'draw')
        .map((e, i) => ({ n: i + 1, role: e.role, position: e.position, name: e.name, at: e.at, ...(e.replacing ? { replacement: true } : {}) })),
      replacements: draw.replaced.map((r) => ({
        position: r.position, out: r.out.name, in: r.in.name, from: r.from, reason: r.reason, at: r.at,
      })),
      winners: draw.winners.map((w, i) => ({ position: i + 1, name: w.name })),
      alternatesList: draw.alternates.map((a, i) => ({ position: i + 1, name: a.name })),
    },
  };
}

function filtersSummary(audit) {
  const f = audit.filters;
  const parts = [];
  if (audit.source === 'api') {
    parts.push(f.checkedInOnly ? 'solo con check-in' : 'con check-in o asistencia confirmada');
    parts.push(f.includeCreator ? 'el creador participa' : 'sin el creador');
  }
  parts.push(f.onePerMember ? 'una entrada por persona' : (audit.source === 'api' ? 'una entrada por evento' : 'nombres repetidos cuentan doble'));
  return parts.join(' · ');
}

/** Texto plano con emojis, sin markdown, para que se vea bien en WhatsApp y en Discord. */
export function formatResultsText(audit, { timeZone = TIME_ZONE } = {}) {
  const lines = ['🎉 Sorteo Pokémon GO Caseros'];
  if (audit.source === 'api') {
    for (const e of audit.events) lines.push(`📍 ${e.name}`);
  } else {
    lines.push('📝 Lista cargada a mano');
  }
  lines.push(`📅 ${formatDateTime(audit.draw.startedAt, timeZone)} (hora Argentina)`, '');

  lines.push(audit.draw.winners.length === 1 ? '🏆 Ganador' : '🏆 Ganadores');
  for (const w of audit.draw.winners) lines.push(`${MEDALS[w.position - 1] ?? '🎁'} ${w.position}. ${w.name}`);

  if (audit.draw.alternatesList.length) {
    lines.push('', '🔁 Suplentes');
    for (const a of audit.draw.alternatesList) lines.push(`${a.position}. ${a.name}`);
  }

  if (audit.draw.replacements.length) {
    lines.push('', '🔄 Reemplazos');
    for (const r of audit.draw.replacements) {
      lines.push(`• Puesto ${r.position}: sale ${r.out}${r.reason ? ` (${r.reason})` : ''} → entra ${r.in}`);
    }
  }

  const fp = audit.list.fingerprint ? ` · lista #${audit.list.fingerprint.slice(0, 8)}` : '';
  lines.push(
    '',
    `👥 ${audit.list.participants} participantes · ${filtersSummary(audit)}`,
    `🔒 Intento ${audit.draw.attempt}${fp}`,
  );
  if (audit.source === 'api') lines.push('Datos vía cmpf-tools.de (topi314)');
  return lines.join('\n');
}

/** Resumen legible de los excluidos, p. ej. para mostrar debajo de la lista. */
export function exclusionSummary(excludedByReason) {
  return Object.entries(excludedByReason)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${REASON_LABELS[reason] ?? reason}: ${n}`);
}
