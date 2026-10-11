// Arma la lista de participantes a partir de los eventos (o de una lista
// pegada a mano), aplica los filtros y deja todo listo para revisar.
// Cada entrada lleva `reason`: null si participa, o el motivo por el que
// queda afuera, para poder mostrarlo en la revisión.

import { cleanText, normalizeForMatch } from './text.js';

export const DEFAULT_FILTERS = Object.freeze({
  checkedInOnly: true, // si es false, también entran los ACCEPTED
  onePerMember: true, // si es false, una entrada por miembro y por evento
  includeCreator: false, // los creadores de los eventos participan
});

export const REASON_LABELS = Object.freeze({
  declined: 'Rechazó la invitación',
  notCheckedIn: 'No hizo check-in',
  unknownStatus: 'Estado de asistencia desconocido',
  creator: 'Creador del evento',
  blocked: 'Está en la lista de bloqueados',
  removed: 'Quitado a mano en la revisión',
  noName: 'Sin nombre público',
});

export const MAX_MANUAL_LINES = 5000;

const STATUS_RANK = { CHECKED_IN: 3, ACCEPTED: 2, DECLINED: 1 };

export function displayName(person) {
  return cleanText(person?.display_name) || cleanText(person?.username) || '';
}

// Texto para mostrar en la revisión: los que no tienen nombre se distinguen por el final del ID.
export function entryLabel(entry) {
  return entry.name || `(sin nombre) …${String(entry.memberId).slice(-4)}`;
}

// Devuelve una función que dice si una persona está bloqueada (por usuario, nombre o ID).
export function blockedMatcher(blocked = []) {
  const wanted = new Set(blocked.map(normalizeForMatch).filter(Boolean));
  return (person) => wanted.size > 0 && [person.username, person.displayName, person.memberId]
    .map(normalizeForMatch)
    .some((v) => v && wanted.has(v));
}

function statusReason(status, filters) {
  if (status === 'DECLINED') return 'declined';
  if (status === 'ACCEPTED') return filters.checkedInOnly ? 'notCheckedIn' : null;
  if (status === 'CHECKED_IN') return null;
  return 'unknownStatus';
}

function sortEntries(entries) {
  return entries.sort((a, b) =>
    entryLabel(a).localeCompare(entryLabel(b), 'es', { sensitivity: 'base' }) || a.key.localeCompare(b.key));
}

function summarize(entries, extra = {}) {
  sortEntries(entries);
  const byReason = {};
  for (const e of entries) if (e.reason) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
  const eligible = entries.filter((e) => !e.reason);
  return {
    entries,
    eligible,
    nameless: entries.filter((e) => e.reason === 'noName'),
    counts: { total: entries.length, eligible: eligible.length, byReason },
    ...extra,
  };
}

/**
 * @param {ReturnType<import('./api.js').normalizeEvent>[]} events
 * @param {{filters?: typeof DEFAULT_FILTERS, blocked?: string[], removed?: string[]}} options
 *   blocked: nombres/usuarios/IDs bloqueados (persistentes)
 *   removed: memberId quitados a mano en esta revisión
 */
export function buildParticipants(events, { filters = DEFAULT_FILTERS, blocked = [], removed = [] } = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const creatorIds = new Set(events.map((e) => e.creator?.id).filter(Boolean));
  const removedSet = new Set(removed);
  const isBlocked = blockedMatcher(blocked);
  const groups = new Map();

  for (const event of events) {
    for (const m of event.members) {
      // Sin "una por miembro": igual se junta al mismo miembro dentro de un evento,
      // porque la API puede repetirlo (p. ej. ACCEPTED y CHECKED_IN).
      const key = f.onePerMember ? m.id : `${event.id}|${m.id}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, memberId: m.id, username: '', displayName: '', status: '', eventIds: [] };
        groups.set(key, g);
      }
      g.username ||= cleanText(m.username);
      g.displayName ||= cleanText(m.display_name);
      if ((STATUS_RANK[m.rsvp_status] ?? 0) > (STATUS_RANK[g.status] ?? 0) || !g.status) g.status = m.rsvp_status;
      if (!g.eventIds.includes(event.id)) g.eventIds.push(event.id);
    }
  }

  const entries = [...groups.values()].map((g) => {
    const name = g.displayName || g.username;
    let reason = statusReason(g.status, f);
    if (!reason && creatorIds.has(g.memberId) && !f.includeCreator) reason = 'creator';
    if (!reason && isBlocked(g)) reason = 'blocked';
    if (!reason && removedSet.has(g.memberId)) reason = 'removed';
    if (!reason && !name) reason = 'noName';
    return { ...g, name, reason };
  });

  return summarize(entries, { source: 'api', filters: f });
}

/**
 * Modo manual: un nombre por línea. Acepta listas numeradas o con viñetas.
 */
export function buildManualParticipants(text, { filters = DEFAULT_FILTERS, blocked = [], removed = [] } = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const removedSet = new Set(removed);
  const isBlocked = blockedMatcher(blocked);
  const lines = String(text ?? '').split(/\r?\n/);
  const names = lines
    .map((line) => cleanText(line.replace(/^\s*(?:\d+\s*[.)-]|[-*•·])\s+/, '')))
    .filter(Boolean);
  const truncated = names.length > MAX_MANUAL_LINES;
  const entries = [];
  const seen = new Set();
  let merged = 0;

  names.slice(0, MAX_MANUAL_LINES).forEach((name, i) => {
    const norm = normalizeForMatch(name);
    if (f.onePerMember && seen.has(norm)) { merged += 1; return; }
    seen.add(norm);
    const key = f.onePerMember ? `manual:${norm}` : `manual:${i}`;
    const entry = { key, memberId: key, username: '', displayName: name, name, status: '', eventIds: [] };
    let reason = null;
    if (isBlocked(entry)) reason = 'blocked';
    else if (removedSet.has(key)) reason = 'removed';
    entries.push({ ...entry, reason });
  });

  return summarize(entries, { source: 'manual', filters: f, merged, truncated });
}

/**
 * ¿Se puede cerrar la lista? Los participantes sin nombre nunca entran al sorteo,
 * pero mientras haya alguno hay que confirmar que se los ignora (o volver a traer).
 */
export function canCloseList(list, { ignoreNameless = false } = {}) {
  if (list.nameless.length && !ignoreNameless) return { ok: false, problem: 'nameless', count: list.nameless.length };
  if (!list.eligible.length) return { ok: false, problem: 'empty', count: 0 };
  return { ok: true, problem: null, count: list.eligible.length };
}

/**
 * Cierra la lista: congela a los participantes que van al sorteo.
 * @returns {{ok: false, problem: string} | {ok: true, closed: object}}
 */
export function closeList(list, { ignoreNameless = false, now = new Date() } = {}) {
  const check = canCloseList(list, { ignoreNameless });
  if (!check.ok) return check;
  const pool = list.eligible.map(({ key, memberId, name, username, eventIds }) =>
    Object.freeze({ key, memberId, name, username, eventIds: Object.freeze([...eventIds]) }));
  return {
    ok: true,
    closed: Object.freeze({
      pool: Object.freeze(pool),
      closedAt: now.toISOString(),
      source: list.source,
      filters: list.filters,
      excludedByReason: { ...list.counts.byReason },
      removedNames: list.entries.filter((e) => e.reason === 'removed').map(entryLabel),
      ignoredNameless: list.nameless.length,
    }),
  };
}
