// Controlador de la interfaz: une la lógica (links, api, participants,
// raffle, audit, storage) con el HTML. Todo texto externo entra al DOM
// con textContent (ver dom.js).

import { parseEventInput, MAX_EVENTS } from './links.js';
import { fetchEvents } from './api.js';
import {
  DEFAULT_FILTERS, REASON_LABELS, buildParticipants, buildManualParticipants,
  canCloseList, closeList, entryLabel,
} from './participants.js';
import {
  createDraw, drawNext, drawAll, replaceWinner, repeatDraw, isComplete, winnersComplete, RaffleError,
} from './raffle.js';
import { buildAudit, formatResultsText, formatDateTime, listFingerprint, exclusionSummary, TIME_ZONE } from './audit.js';
import { loadBlocked, saveBlocked, parseBlockedText, loadPrefs, savePrefs } from './storage.js';
import { cleanText } from './text.js';
import { h, clear, $, announce, toast, confirmDialog, showDialog, wait } from './dom.js';
import { rollNames, confetti } from './reveal.js';
import { setupPwa } from './pwa.js';

const MEDALS = ['🥇', '🥈', '🥉'];

const state = {
  view: 'load',
  source: 'api', // 'api' | 'manual'
  items: [], // links válidos de la última búsqueda (para "Volver a traer")
  events: [],
  failures: [],
  invalid: [],
  manualText: '',
  filters: { ...DEFAULT_FILTERS },
  removed: new Set(),
  blocked: loadBlocked(),
  ignoreNameless: false,
  prefs: loadPrefs(),
  search: '',
  list: null,
  closed: null,
  fingerprint: null,
  draw: null,
  mode: 'oneByOne',
  revealing: false,
  skip: null,
  loading: false,
};

const ids = [
  'view-load', 'view-review', 'view-draw', 'tab-api', 'tab-manual', 'panel-api', 'panel-manual', 'links', 'fetch-btn',
  'load-status', 'manual', 'manual-status', 'back-to-load', 'refresh-btn', 'review-events', 'review-alerts', 'f-checkin',
  'f-one', 'f-creator', 'review-count', 'search', 'eligible-list', 'eligible-empty', 'excluded-box', 'excluded-count',
  'excluded-list', 'blocked', 'save-blocked', 'blocked-status', 'winners', 'alternates', 'prize-error', 'close-list',
  'close-hint', 'stage', 'stage-kicker', 'present-btn', 'stage-title', 'stage-meta', 'roller', 'roller-name', 'draw-btn',
  'draw-rest-btn', 'skip-btn', 'winners-board', 'alternates-title', 'alternates-board', 'exit-present', 'result-actions',
  'copy-btn', 'share-btn', 'download-btn', 'repeat-btn', 'reopen-btn', 'new-btn', 'audit-content', 'dlg-replace',
  'dlg-replace-text', 'replace-reason', 'dlg-copy', 'copy-fallback',
];
const el = Object.fromEntries(ids.map((id) => [id.replace(/-(\w)/g, (_, c) => c.toUpperCase()), document.getElementById(id)]));

/* ======================== Navegación ======================== */

function showView(view, { focus = true } = {}) {
  state.view = view;
  for (const v of ['load', 'review', 'draw']) el[`view${v[0].toUpperCase()}${v.slice(1)}`].hidden = v !== view;
  document.querySelectorAll('.steps li').forEach((li) => {
    if (li.dataset.step === view) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0 });
  if (focus) $('#main').focus({ preventScroll: true });
  updateWakeLock();
}

function selectTab(tab) {
  const isApi = tab === 'api';
  el.tabApi.setAttribute('aria-selected', String(isApi));
  el.tabManual.setAttribute('aria-selected', String(!isApi));
  el.tabApi.tabIndex = isApi ? 0 : -1;
  el.tabManual.tabIndex = isApi ? -1 : 0;
  el.panelApi.hidden = !isApi;
  el.panelManual.hidden = isApi;
}

/* ======================== Paso 1: cargar ======================== */

const shortText = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function alertBox(kind, title, items = [], actions = []) {
  return h('div', { class: `alert alert-${kind}`, role: kind === 'error' ? 'alert' : null },
    h('p', { class: 'alert-title' }, title),
    items.length ? h('ul', {}, items.map((t) => h('li', {}, t))) : null,
    actions.length ? h('div', { class: 'alert-actions' }, actions) : null);
}

const manualButton = () => h('button', {
  type: 'button', class: 'btn btn-secondary btn-sm',
  onclick: () => { showView('load'); selectTab('manual'); el.manual.focus(); },
}, '📝 Usar lista manual');

function failureItems(failures) {
  return failures.map((f) => `${shortText(f.input)}: ${f.error.message}`);
}

async function onFetchSubmit(event) {
  event.preventDefault();
  if (state.loading) return;
  const parsed = parseEventInput(el.links.value);
  if (!parsed.events.length) {
    const msg = parsed.invalid.length ? 'Ese link no sirve' : 'Pegá el link del evento';
    const items = parsed.invalid.map((i) => `${shortText(i.input)}: ${i.reason}`);
    el.loadStatus.replaceChildren(alertBox('error', msg, items));
    el.links.focus();
    return;
  }
  if (!parsed.withinLimit) {
    el.loadStatus.replaceChildren(alertBox('error', `Podés sumar hasta ${MAX_EVENTS} eventos por sorteo.`));
    return;
  }
  state.invalid = parsed.invalid;
  await loadEvents(parsed.events, { refresh: false });
}

function setLoading(on, statusEl) {
  state.loading = on;
  el.fetchBtn.disabled = on;
  el.refreshBtn.disabled = on;
  if (on) statusEl.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Buscando participantes en Campfire…');
}

async function loadEvents(items, { refresh }) {
  const statusEl = refresh ? el.reviewAlerts : el.loadStatus;
  setLoading(true, refresh ? el.reviewCount : statusEl);
  const result = await fetchEvents(items);
  setLoading(false);

  if (!result.events.length) {
    const manual = result.failures.some((f) => f.error.suggestManual);
    const box = alertBox('error',
      items.length === 1 ? 'No pude traer el evento' : 'No pude traer ningún evento',
      failureItems(result.failures),
      manual ? [h('span', {}, 'Si cmpf-tools.de no anda, podés seguir con una lista pegada a mano.'), manualButton()] : []);
    if (refresh) { renderReview(); el.reviewAlerts.prepend(box); toast('No se pudo actualizar la lista', { error: true }); } else statusEl.replaceChildren(box);
    return;
  }

  el.loadStatus.replaceChildren();
  state.source = 'api';
  state.items = items;
  state.events = result.events;
  state.failures = result.failures;
  if (!refresh) {
    state.removed.clear();
    state.ignoreNameless = false;
    state.search = '';
    el.search.value = '';
    state.filters = { ...DEFAULT_FILTERS };
  }
  recompute();
  if (refresh) toast('Lista actualizada ✅');
  else showView('review');
}

function onManualSubmit(event) {
  event.preventDefault();
  const text = el.manual.value;
  if (!buildManualParticipants(text).entries.length) {
    el.manualStatus.replaceChildren(alertBox('error', 'Pegá al menos un nombre, uno por línea.'));
    el.manual.focus();
    return;
  }
  el.manualStatus.replaceChildren();
  state.source = 'manual';
  state.manualText = text;
  state.events = [];
  state.failures = [];
  state.invalid = [];
  state.removed.clear();
  state.ignoreNameless = false;
  state.search = '';
  el.search.value = '';
  state.filters = { ...DEFAULT_FILTERS };
  recompute();
  showView('review');
}

/* ======================== Paso 2: revisar ======================== */

function recompute() {
  const options = { filters: state.filters, blocked: state.blocked, removed: [...state.removed] };
  state.list = state.source === 'api'
    ? buildParticipants(state.events, options)
    : buildManualParticipants(state.manualText, options);
  renderReview();
}

function renderEvents() {
  if (state.source === 'manual') {
    const { list } = state;
    return [h('div', { class: 'event-card' },
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📝'),
      h('div', {}, h('h2', {}, 'Lista manual'), h('p', {}, `${list.entries.length} nombres cargados`)))];
  }
  return state.events.map((e) => h('div', { class: 'event-card' },
    h('span', { class: 'emoji', 'aria-hidden': 'true' }, '📍'),
    h('div', {},
      h('h2', {}, e.name),
      h('p', {}, [formatDateTime(e.time), `${e.members.length} anotados`].filter(Boolean).join(' · ')),
      e.url ? h('p', {}, h('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer' }, 'Ver en Campfire ↗')) : null)));
}

function renderAlerts() {
  const { list } = state;
  const out = [];
  if (state.failures.length) {
    out.push(alertBox('warn', `No pude traer ${state.failures.length === 1 ? 'un link' : `${state.failures.length} links`}; sigo con el resto.`,
      failureItems(state.failures)));
  }
  if (state.invalid.length) {
    out.push(alertBox('info', `Ignoré ${state.invalid.length === 1 ? 'un texto que no es' : `${state.invalid.length} textos que no son`} link de Campfire.`,
      state.invalid.slice(0, 5).map((i) => shortText(i.input, 40))));
  }
  if (list.source === 'manual' && list.truncated) {
    out.push(alertBox('warn', 'La lista era muy larga: solo se usan los primeros 5000 nombres.'));
  }
  if (list.nameless.length) {
    const n = list.nameless.length;
    const ignore = h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', id: 'ignore-nameless', checked: state.ignoreNameless,
        onchange: (ev) => { state.ignoreNameless = ev.target.checked; renderCloseState(); },
      }),
      h('span', {}, 'Ignorar participantes sin nombre y seguir'));
    out.push(h('div', { class: 'alert alert-warn' },
      h('p', { class: 'alert-title' }, `⚠️ ${n === 1 ? 'Hay 1 participante' : `Hay ${n} participantes`} sin nombre público: ${n === 1 ? 'queda' : 'quedan'} fuera del sorteo.`),
      h('p', {}, 'Puede ser un problema momentáneo de Campfire. Pedile que revise su perfil o su check-in en la quedada y después tocá “Volver a traer”.'),
      h('div', { class: 'alert-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: onRefresh, disabled: state.source !== 'api' }, '🔄 Volver a traer'),
        ignore)));
  }
  if (!list.eligible.length) {
    const noCheckins = list.source === 'api' && state.filters.checkedInOnly && list.counts.byReason.notCheckedIn;
    out.push(alertBox('error', noCheckins
      ? 'Nadie hizo check-in todavía. Podés esperar y tocar “Volver a traer”, o destildar “Solo con check-in”.'
      : 'No queda nadie para sortear con estos filtros.'));
  }
  return out;
}

function personMeta(entry) {
  const meta = [];
  if (entry.username && entry.username !== entry.name) meta.push(`@${entry.username}`);
  if (entry.eventIds.length > 1) meta.push(`${entry.eventIds.length} eventos`);
  return meta.join(' · ');
}

function renderPeople() {
  const { list } = state;
  const q = cleanText(state.search).toLowerCase();
  const match = (e) => !q || entryLabel(e).toLowerCase().includes(q) || e.username.toLowerCase().includes(q);

  const eligible = list.eligible.filter(match);
  el.eligibleList.replaceChildren(...eligible.map((e) => {
    const label = entryLabel(e);
    return h('li', { dataset: { key: e.key } },
      h('span', { class: 'person' },
        h('span', { class: 'person-name' }, label,
          e.status === 'ACCEPTED' ? h('span', { class: 'badge badge-accepted' }, 'sin check-in') : null),
        personMeta(e) ? h('span', { class: 'person-meta' }, personMeta(e)) : null),
      h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `Quitar a ${label} del sorteo`,
        onclick: () => removePerson(e),
      }, '✕ Quitar'));
  }));
  el.eligibleEmpty.hidden = eligible.length > 0;
  el.eligibleEmpty.textContent = q ? `Nadie coincide con “${shortText(state.search, 30)}”.` : 'No hay participantes.';

  const excluded = list.entries.filter((e) => e.reason).filter(match);
  el.excludedCount.textContent = String(list.entries.length - list.eligible.length);
  el.excludedList.replaceChildren(...excluded.map((e) => {
    const label = entryLabel(e);
    return h('li', {},
      h('span', { class: 'person' },
        h('span', { class: 'person-name' }, label),
        h('span', { class: 'person-meta' }, REASON_LABELS[e.reason] ?? e.reason)),
      e.reason === 'removed'
        ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Volver a sumar a ${label}`, onclick: () => restorePerson(e) }, '↩ Sumar')
        : null);
  }));

  el.reviewCount.replaceChildren(
    h('span', { class: 'big' }, String(list.eligible.length)),
    ` ${list.eligible.length === 1 ? 'participa' : 'participan'} · ${list.entries.length - list.eligible.length} afuera`);
}

function renderCloseState() {
  const check = canCloseList(state.list, { ignoreNameless: state.ignoreNameless });
  const winners = Number(el.winners.value);
  let error = '';
  if (!Number.isInteger(winners) || winners < 1) error = 'Poné cuántos premios hay (1 o más).';
  else if (check.ok && winners > check.count) error = `Hay ${check.count} participantes: no alcanza para ${winners} premios.`;
  const alternates = Number(el.alternates.value || 0);
  if (!error && (!Number.isInteger(alternates) || alternates < 0)) error = 'Los suplentes tienen que ser 0 o más.';
  el.prizeError.textContent = error;

  el.closeList.disabled = !check.ok || Boolean(error);
  if (check.problem === 'nameless') el.closeHint.textContent = 'Hay participantes sin nombre: volvé a traer la lista o tildá “Ignorar participantes sin nombre”.';
  else if (check.problem === 'empty') el.closeHint.textContent = 'No hay participantes para sortear.';
  else if (!error) el.closeHint.textContent = `Se ${winners === 1 ? 'sortea 1 premio' : `sortean ${winners} premios`} entre ${check.count} participantes. Después de cerrar, la lista no se puede tocar.`;
  else el.closeHint.textContent = '';
}

function renderReview() {
  const isApi = state.source === 'api';
  el.reviewEvents.replaceChildren(...renderEvents());
  el.reviewAlerts.replaceChildren(...renderAlerts());
  el.refreshBtn.hidden = !isApi;
  el.backToLoad.textContent = isApi ? '← Cambiar evento' : '← Editar lista';
  el.fCheckin.closest('label').hidden = !isApi;
  el.fCreator.closest('label').hidden = !isApi;
  el.fOne.nextElementSibling.firstChild.textContent = isApi ? 'Una entrada por persona ' : 'Nombres repetidos cuentan una sola vez ';
  el.fOne.nextElementSibling.querySelector('small').hidden = !isApi;
  el.fCheckin.checked = state.filters.checkedInOnly;
  el.fOne.checked = state.filters.onePerMember;
  el.fCreator.checked = state.filters.includeCreator;
  renderPeople();
  renderCloseState();
}

function focusAfterListChange(index) {
  const buttons = el.eligibleList.querySelectorAll('button');
  (buttons[Math.min(index, buttons.length - 1)] ?? el.search).focus();
}

function removePerson(entry) {
  const index = [...el.eligibleList.children].findIndex((li) => li.dataset.key === entry.key);
  state.removed.add(entry.memberId);
  recompute();
  announce(`${entryLabel(entry)} quedó afuera del sorteo.`);
  focusAfterListChange(Math.max(index, 0));
}

function restorePerson(entry) {
  state.removed.delete(entry.memberId);
  recompute();
  announce(`${entryLabel(entry)} vuelve a participar.`);
  (el.excludedList.querySelector('button') ?? el.search).focus();
}

function onRefresh() {
  if (state.source !== 'api' || !state.items.length || state.loading) return;
  loadEvents(state.items, { refresh: true });
}

function onSaveBlocked() {
  const { saved, list } = saveBlocked(parseBlockedText(el.blocked.value));
  state.blocked = list;
  el.blocked.value = list.join('\n');
  navigator.storage?.persist?.().catch(() => {});
  el.blockedStatus.textContent = saved
    ? `Guardado ✅ (${list.length === 1 ? '1 bloqueado' : `${list.length} bloqueados`})`
    : 'No se pudo guardar en este dispositivo (¿modo privado?). Se aplican igual hasta que cierres la app.';
  recompute();
}

function selectedMode() {
  return document.querySelector('input[name="mode"]:checked')?.value ?? 'oneByOne';
}

function fillPrefs() {
  el.winners.value = String(state.prefs.winners);
  el.alternates.value = String(state.prefs.alternates);
  const radio = document.querySelector(`input[name="mode"][value="${state.prefs.mode}"]`);
  if (radio) radio.checked = true;
}

async function onCloseList() {
  const result = closeList(state.list, { ignoreNameless: state.ignoreNameless });
  if (!result.ok) { renderCloseState(); return; }
  const winners = Number(el.winners.value);
  const alternates = Number(el.alternates.value || 0);
  let draw;
  try {
    draw = createDraw(result.closed, { winners, alternates });
  } catch (err) {
    if (!(err instanceof RaffleError)) throw err;
    el.prizeError.textContent = err.message;
    return;
  }
  state.mode = selectedMode();
  state.prefs = savePrefs({ winners, alternates, mode: state.mode }).prefs;
  state.closed = result.closed;
  state.draw = draw;
  state.fingerprint = await listFingerprint(result.closed.pool).catch(() => null);
  el.roller.hidden = true;
  showView('draw');
  renderStage();
  el.drawBtn.focus();
}

/* ======================== Paso 3: sorteo ======================== */

const nameOf = (key) => state.closed.pool.find((p) => p.key === key)?.name ?? '';
const drawCount = () => state.draw.log.filter((e) => e.type === 'draw').length;
const posLabel = (role, pos) => (role === 'winner' ? `${pos}° premio` : `Suplente ${pos}`);

function stageTitle() {
  const d = state.draw;
  const N = d.config.winners;
  if (isComplete(d)) return d.winners.length === 1 ? '🏆 ¡Tenemos ganador!' : '🏆 ¡Tenemos ganadores!';
  if (!drawCount()) return N === 1 ? '¡A sortear el premio!' : `¡A sortear ${N} premios!`;
  if (!winnersComplete(d)) return `Premio ${d.winners.length + 1} de ${N}`;
  return `Suplente ${d.alternates.length + 1} de ${d.config.alternates}`;
}

function drawButtonLabel() {
  const d = state.draw;
  if (state.mode === 'all') {
    if (drawCount()) return '🎲 Sortear los que faltan';
    return d.config.winners === 1 ? '🎲 ¡Sortear!' : `🎲 ¡Sortear el Top ${d.config.winners}!`;
  }
  if (!winnersComplete(d)) return `🎲 Sacar el ${d.winners.length + 1}° premio`;
  return `🎲 Sacar suplente ${d.alternates.length + 1}`;
}

function prizeItem(entry, role, pos, { note = '', highlight = false, pending = false } = {}) {
  const isFirst = role === 'winner' && pos === 1;
  const medal = role === 'winner' ? (MEDALS[pos - 1] ?? '🎁') : '🔁';
  return h('li', {
    class: ['prize', isFirst && 'is-first', highlight && 'is-new', pending && 'is-pending'].filter(Boolean).join(' '),
    dataset: { key: entry?.key ?? '', role, pos: String(pos) },
  },
  h('span', { class: 'prize-medal', 'aria-hidden': 'true' }, medal),
  h('span', { class: 'prize-body' },
    h('span', { class: 'prize-pos' }, posLabel(role, pos)),
    h('span', { class: 'prize-name' }, pending ? '???' : entry.name),
    note ? h('span', { class: 'prize-note' }, note) : null),
  role === 'winner' && !pending && !state.revealing
    ? h('span', { class: 'prize-actions' },
      h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `Reemplazar a ${entry.name} (${pos}° premio)`,
        onclick: () => onReplace(entry.key),
      }, 'Reemplazar'))
    : null);
}

function renderBoards({ highlightKey = null } = {}) {
  const d = state.draw;
  const notes = new Map();
  for (const r of d.replaced) notes.set(r.in.key, `Reemplaza a ${r.out.name}${r.reason ? ` (${r.reason})` : ''}`);
  el.winnersBoard.replaceChildren(...d.winners.map((w, i) =>
    prizeItem(w, 'winner', i + 1, { note: notes.get(w.key), highlight: w.key === highlightKey })));
  el.alternatesBoard.replaceChildren(...d.alternates.map((a, i) =>
    prizeItem(a, 'alternate', i + 1, { highlight: a.key === highlightKey })));
  el.alternatesTitle.hidden = d.alternates.length === 0;
}

function renderStage({ highlightKey = null } = {}) {
  const d = state.draw;
  const fp = state.fingerprint ? ` · lista #${state.fingerprint.slice(0, 8)}` : '';
  el.stageKicker.textContent = `🔒 ${d.closed.pool.length} participantes${fp} · intento ${d.attempt}`;
  el.stageTitle.textContent = stageTitle();
  el.stageMeta.textContent = state.source === 'api' ? state.events.map((e) => e.name).join(' + ') : 'Lista manual';

  const complete = isComplete(d);
  el.drawBtn.hidden = complete || state.revealing;
  el.drawBtn.textContent = drawButtonLabel();
  el.drawBtn.disabled = state.revealing;
  const left = d.config.winners + d.config.alternates - drawCount();
  el.drawRestBtn.hidden = complete || state.mode !== 'oneByOne' || left < 2 || state.revealing;
  el.drawRestBtn.textContent = `⏩ Sacar los ${left} que faltan de una`;
  el.skipBtn.hidden = !state.revealing;

  renderBoards({ highlightKey });
  el.resultActions.hidden = d.winners.length === 0 || state.revealing;
  el.shareBtn.hidden = typeof navigator.share !== 'function';
  for (const b of [el.repeatBtn, el.reopenBtn, el.newBtn]) b.disabled = state.revealing;
  el.repeatBtn.disabled = state.revealing || drawCount() === 0;
  renderAudit();
}

function startReveal() {
  state.revealing = true;
  state.skip = new AbortController();
  renderStage();
  el.skipBtn.focus();
  return state.skip.signal;
}

function endReveal() {
  state.revealing = false;
  state.skip = null;
}

function focusAfterReveal() {
  if (!el.drawBtn.hidden) el.drawBtn.focus();
  else el.copyBtn.focus();
}

async function onDraw() {
  if (state.revealing || isComplete(state.draw)) return;
  if (state.mode === 'all') return revealMany();
  const before = state.draw;
  const { state: next, drawn } = drawNext(before);
  // El resultado ya está decidido; se muestra recién al terminar la animación.
  const signal = startReveal();
  el.roller.hidden = false;
  el.stageTitle.textContent = '🥁 ¡Redoble de tambores!';
  await rollNames(el.rollerName, before.remaining.map(nameOf), drawn.entry.name, { signal });
  state.draw = next;
  endReveal();
  renderStage({ highlightKey: drawn.entry.key });
  confetti({ amount: drawn.role === 'winner' ? (drawn.position === 1 ? 240 : 170) : 70 });
  announce(`${posLabel(drawn.role, drawn.position)}: ${drawn.entry.name}`);
  focusAfterReveal();
}

/** "Top N": se sortea todo junto y se revela del último puesto al primero. */
async function revealMany() {
  const before = state.draw;
  const { state: next } = drawAll(before);
  const signal = startReveal();
  el.roller.hidden = false;
  el.stageTitle.textContent = '🥁 Sorteando…';
  await rollNames(el.rollerName, before.remaining.map(nameOf), '🎉 ¡Ahí van!', { duration: 2200, signal });

  state.draw = next;
  const firstNew = before.winners.length;
  // Tablero con los puestos nuevos tapados.
  el.winnersBoard.replaceChildren(...next.winners.map((w, i) =>
    prizeItem(w, 'winner', i + 1, { pending: i >= firstNew })));
  el.alternatesBoard.replaceChildren();
  el.alternatesTitle.hidden = true;
  const step = next.winners.length > 10 ? 320 : 600;
  for (let i = next.winners.length - 1; i >= firstNew; i -= 1) {
    await wait(i === 0 ? step + 900 : step, signal);
    const li = el.winnersBoard.children[i];
    li.replaceWith(prizeItem(next.winners[i], 'winner', i + 1, { highlight: true }));
    if (i === 0) confetti({ amount: 240 });
  }
  el.roller.hidden = true;
  endReveal();
  renderStage();
  if (signal.aborted) confetti({ amount: 240 });
  const list = next.winners.slice(0, 10).map((w, i) => `${i + 1}: ${w.name}`).join(', ');
  announce(`Ganadores. ${list}${next.winners.length > 10 ? ', y más.' : '.'}`);
  focusAfterReveal();
}

async function onDrawRest() {
  if (state.revealing) return;
  return revealMany();
}

async function onReplace(key) {
  if (state.revealing) return;
  const d = state.draw;
  const index = d.winners.findIndex((w) => w.key === key);
  if (index === -1) return;
  const out = d.winners[index];
  const next = d.alternates[0];
  el.dlgReplaceText.textContent = `¿Reemplazar a ${out.name} en el ${index + 1}° premio? `
    + (next ? `Entra ${next.name}, el primer suplente.` : 'No hay suplentes: se sortea uno nuevo entre los que quedan.')
    + ` ${out.name} no vuelve a participar en este sorteo.`;
  el.replaceReason.value = '';
  if (await showDialog(el.dlgReplace) !== 'ok') return;

  let updated;
  try {
    updated = replaceWinner(d, key, { reason: cleanText(el.replaceReason.value, 60) });
  } catch (err) {
    if (!(err instanceof RaffleError)) throw err;
    toast(err.message, { error: true });
    return;
  }
  const rep = updated.replaced.at(-1);
  if (rep.from === 'pool') {
    const signal = startReveal();
    el.roller.hidden = false;
    el.stageTitle.textContent = `🥁 Nuevo ${rep.position}° premio…`;
    await rollNames(el.rollerName, d.remaining.map(nameOf), rep.in.name, { duration: 1800, signal });
    endReveal();
  }
  state.draw = updated;
  renderStage({ highlightKey: rep.in.key });
  confetti({ amount: 120 });
  announce(`${rep.in.name} reemplaza a ${rep.out.name} en el ${rep.position}° premio.`);
  el.winnersBoard.children[rep.position - 1]?.querySelector('button')?.focus();
}

async function onRepeat() {
  if (state.revealing || !drawCount()) return;
  const ok = await confirmDialog({
    title: '¿Repetir el sorteo?',
    text: `Se descarta el resultado actual y se sortea de nuevo con la misma lista. Queda registrado como intento ${state.draw.attempt + 1}.`,
    ok: 'Repetir',
  });
  if (!ok) return;
  state.draw = repeatDraw(state.draw);
  el.roller.hidden = true;
  renderStage();
  announce('Sorteo reiniciado.');
  el.drawBtn.focus();
}

async function confirmDiscard(text) {
  if (!state.draw || !drawCount()) return true;
  return confirmDialog({ title: '¿Descartar el sorteo?', text, ok: 'Descartar' });
}

async function onReopen() {
  if (state.revealing) return;
  if (!(await confirmDiscard('Para volver a la lista se descarta el sorteo actual.'))) return;
  state.closed = null;
  state.draw = null;
  showView('review');
  recompute();
}

async function onNew() {
  if (state.revealing) return;
  if (!(await confirmDiscard('Se descarta el resultado actual y empezás de cero.'))) return;
  state.closed = null;
  state.draw = null;
  state.events = [];
  state.failures = [];
  state.invalid = [];
  state.items = [];
  state.removed.clear();
  state.ignoreNameless = false;
  state.filters = { ...DEFAULT_FILTERS };
  el.links.value = '';
  showView('load');
  el.links.focus();
}

/* ======================== Resultados y auditoría ======================== */

function currentAudit() {
  return buildAudit({
    events: state.source === 'api' ? state.events : [],
    closed: state.closed,
    draw: state.draw,
    mode: state.mode,
    fingerprint: state.fingerprint,
  });
}

async function onCopy() {
  const text = formatResultsText(currentAudit());
  try {
    await navigator.clipboard.writeText(text);
    toast('¡Copiado! Pegalo en WhatsApp o Discord 🎉');
  } catch {
    el.copyFallback.value = text;
    showDialog(el.dlgCopy);
    el.copyFallback.select();
  }
}

async function onShare() {
  try {
    await navigator.share({ title: 'Resultados del sorteo', text: formatResultsText(currentAudit()) });
  } catch (err) {
    if (err?.name !== 'AbortError') onCopy();
  }
}

function onDownload() {
  const audit = currentAudit();
  const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
  const stamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date()).replace(/[^0-9]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sorteo-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Auditoría descargada 💾');
}

const timeOnly = (iso) => new Intl.DateTimeFormat('es-AR', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date(iso));

function renderAudit() {
  const a = currentAudit();
  const f = a.filters;
  const yesNo = (v) => (v ? 'sí' : 'no');
  const rows = [
    ['Origen', a.source === 'api' ? 'Campfire (cmpf-tools.de)' : 'Lista manual'],
    ...a.events.map((e) => ['Evento', `${e.name}${e.time ? ` · ${formatDateTime(e.time)}` : ''}`]),
    ...(a.source === 'api' ? [
      ['Solo con check-in', yesNo(f.checkedInOnly)],
      ['Creador participa', yesNo(f.includeCreator)],
    ] : []),
    ['Una entrada por persona', yesNo(f.onePerMember)],
    ['Lista cerrada', formatDateTime(a.list.closedAt)],
    ['Participantes', String(a.list.participants)],
    ['Quedaron afuera', exclusionSummary(a.list.excludedByReason).join(' · ') || 'nadie'],
    ...(a.list.removedNames.length ? [['Quitados a mano', a.list.removedNames.join(', ')]] : []),
    ...(a.list.ignoredNameless ? [['Sin nombre (ignorados)', String(a.list.ignoredNameless)]] : []),
    ['Premios / suplentes', `${a.draw.prizes} / ${a.draw.alternates}${a.draw.alternatesRequested > a.draw.alternates ? ` (se pidieron ${a.draw.alternatesRequested})` : ''}`],
    ['Revelado', a.draw.mode === 'all' ? 'Todos juntos' : 'Uno por uno'],
    ['Intento', String(a.draw.attempt)],
  ];
  const content = [
    h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    a.list.fingerprint ? h('p', {}, 'Huella de la lista (SHA-256): ', h('code', {}, a.list.fingerprint)) : null,
    h('h3', {}, 'Orden de salida'),
    a.draw.order.length
      ? h('ol', {}, a.draw.order.map((o) => h('li', {},
        `${posLabel(o.role, o.position)}${o.replacement ? ' (reemplazo)' : ''}: ${o.name} · ${timeOnly(o.at)}`)))
      : h('p', { class: 'hint' }, 'Todavía no salió nadie.'),
    a.draw.replacements.length ? h('h3', {}, 'Reemplazos') : null,
    a.draw.replacements.length ? h('ul', {}, a.draw.replacements.map((r) => h('li', {},
      `${r.position}° premio: sale ${r.out}${r.reason ? ` (${r.reason})` : ''}, entra ${r.in} (${r.from === 'alternate' ? 'suplente' : 'sorteado del resto'}) · ${timeOnly(r.at)}`))) : null,
    h('details', {},
      h('summary', {}, `Participantes de la lista cerrada (${a.list.participants})`),
      h('ol', {}, a.list.participantNames.map((n) => h('li', {}, n)))),
  ];
  el.auditContent.replaceChildren(...content.flat().filter(Boolean));
}

/* ======================== Pantalla completa ======================== */

let wakeLock = null;
async function updateWakeLock() {
  // Mantiene la pantalla prendida mientras se está en el paso del sorteo.
  const want = state.view === 'draw' && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* sin permiso o no soportado: no pasa nada */ }
}

async function setPresenting(on) {
  document.body.classList.toggle('is-presenting', on);
  if (on) {
    try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* iPhone no lo soporta: queda el modo CSS */ }
    el.exitPresent.focus();
  } else {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    el.presentBtn.focus();
  }
}

/* ======================== Eventos ======================== */

function bind() {
  el.tabApi.addEventListener('click', () => selectTab('api'));
  el.tabManual.addEventListener('click', () => selectTab('manual'));
  for (const tab of [el.tabApi, el.tabManual]) {
    tab.addEventListener('keydown', (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
      ev.preventDefault();
      const target = tab === el.tabApi ? 'manual' : 'api';
      selectTab(ev.key === 'Home' ? 'api' : ev.key === 'End' ? 'manual' : target);
      (el.tabApi.getAttribute('aria-selected') === 'true' ? el.tabApi : el.tabManual).focus();
    });
  }
  el.panelApi.addEventListener('submit', onFetchSubmit);
  el.panelManual.addEventListener('submit', onManualSubmit);

  el.backToLoad.addEventListener('click', () => { showView('load'); selectTab(state.source); });
  el.refreshBtn.addEventListener('click', onRefresh);
  el.fCheckin.addEventListener('change', () => { state.filters.checkedInOnly = el.fCheckin.checked; recompute(); });
  el.fOne.addEventListener('change', () => { state.filters.onePerMember = el.fOne.checked; recompute(); });
  el.fCreator.addEventListener('change', () => { state.filters.includeCreator = el.fCreator.checked; recompute(); });
  el.search.addEventListener('input', () => { state.search = el.search.value; renderPeople(); });
  el.saveBlocked.addEventListener('click', onSaveBlocked);
  for (const input of [el.winners, el.alternates]) input.addEventListener('input', renderCloseState);
  el.closeList.addEventListener('click', onCloseList);

  el.drawBtn.addEventListener('click', onDraw);
  el.drawRestBtn.addEventListener('click', onDrawRest);
  el.skipBtn.addEventListener('click', () => state.skip?.abort());
  el.presentBtn.addEventListener('click', () => setPresenting(true));
  el.exitPresent.addEventListener('click', () => setPresenting(false));
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('is-presenting')) setPresenting(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && document.body.classList.contains('is-presenting') && !document.querySelector('dialog[open]')) setPresenting(false);
  });
  document.addEventListener('visibilitychange', updateWakeLock);

  el.copyBtn.addEventListener('click', onCopy);
  el.shareBtn.addEventListener('click', onShare);
  el.downloadBtn.addEventListener('click', onDownload);
  el.repeatBtn.addEventListener('click', onRepeat);
  el.reopenBtn.addEventListener('click', onReopen);
  el.newBtn.addEventListener('click', onNew);

  // Aviso si se cierra la pestaña con un sorteo hecho.
  window.addEventListener('beforeunload', (ev) => {
    if (state.view === 'draw' && state.draw && drawCount()) ev.preventDefault();
  });
}

function init() {
  bind();
  fillPrefs();
  el.blocked.value = state.blocked.join('\n');
  selectTab('api');
  showView('load', { focus: false });
  setupPwa();
}

init();
