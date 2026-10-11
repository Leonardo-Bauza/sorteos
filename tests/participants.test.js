import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../js/api.js';
import {
  buildParticipants, buildManualParticipants, canCloseList, closeList,
  displayName, entryLabel, blockedMatcher, DEFAULT_FILTERS,
} from '../js/participants.js';
import { rawEvent, member, EVENT_ID, EVENT_ID_2 } from './fixtures.js';


const ev = (overrides) => normalizeEvent(rawEvent(overrides));
const names = (list) => list.map((e) => e.name);
const reasonOf = (list, name) => list.entries.find((e) => e.name === name)?.reason;

test('por defecto: solo check-in, sin creador, una entrada por miembro', () => {
  const list = buildParticipants([ev()]);
  assert.deepEqual(names(list.eligible), ['Ana', 'Beto']);
  assert.equal(reasonOf(list, 'Organiza'), 'creator');
  assert.equal(reasonOf(list, 'Cami'), 'notCheckedIn');
  assert.equal(reasonOf(list, 'Dani'), 'declined');
  assert.deepEqual(list.counts, {
    total: 5, eligible: 2, byReason: { creator: 1, notCheckedIn: 1, declined: 1 },
  });
  assert.deepEqual(list.filters, DEFAULT_FILTERS);
});

test('desactivando "solo check-in" entran los ACCEPTED, nunca los DECLINED', () => {
  const list = buildParticipants([ev()], { filters: { checkedInOnly: false } });
  assert.deepEqual(names(list.eligible), ['Ana', 'Beto', 'Cami']);
  assert.equal(reasonOf(list, 'Dani'), 'declined');
});

test('la casilla del creador lo deja participar', () => {
  const list = buildParticipants([ev()], { filters: { includeCreator: true } });
  assert.deepEqual(names(list.eligible), ['Ana', 'Beto', 'Organiza']);
});

test('el creador de cualquiera de los eventos cargados queda afuera de todos', () => {
  const e2 = ev({ id: EVENT_ID_2, creator: { id: 'E:ANA', username: 'Ana', display_name: 'Ana' } });
  const list = buildParticipants([ev(), e2]);
  assert.equal(reasonOf(list, 'Ana'), 'creator');
  assert.equal(reasonOf(list, 'Organiza'), 'creator');
});

test('estado desconocido no participa', () => {
  const list = buildParticipants([ev({ members: [member('X', 'Xime', 'MAYBE')] })]);
  assert.equal(reasonOf(list, 'Xime'), 'unknownStatus');
});

test('duplicado ACCEPTED + CHECKED_IN del mismo miembro cuenta como check-in y una sola vez', () => {
  const e = ev({ members: [member('ANA', 'Ana', 'ACCEPTED'), member('ANA', 'Ana', 'CHECKED_IN')] });
  for (const onePerMember of [true, false]) {
    const list = buildParticipants([e], { filters: { onePerMember } });
    assert.equal(list.eligible.length, 1, `onePerMember=${onePerMember}`);
    assert.equal(list.eligible[0].status, 'CHECKED_IN');
  }
});

test('varios eventos: una entrada por miembro vs. una por evento', () => {
  const e2 = ev({ id: EVENT_ID_2, members: [member('ANA', 'Ana'), member('EVA', 'Eva')] });
  const one = buildParticipants([ev(), e2]);
  assert.deepEqual(names(one.eligible), ['Ana', 'Beto', 'Eva']);
  assert.deepEqual(one.eligible.find((e) => e.name === 'Ana').eventIds, [EVENT_ID, EVENT_ID_2]);

  const perEvent = buildParticipants([ev(), e2], { filters: { onePerMember: false } });
  assert.deepEqual(names(perEvent.eligible), ['Ana', 'Ana', 'Beto', 'Eva']);
  assert.equal(new Set(perEvent.eligible.map((e) => e.key)).size, 4);
});

test('nombre: display_name, si no username; sin ninguno queda afuera por "sin nombre"', () => {
  const e = ev({
    members: [
      member('A', '', 'CHECKED_IN', { username: 'solo_user', display_name: '' }),
      member('NONAME1234', '', 'CHECKED_IN', { username: '', display_name: '' }),
      member('NONAMEDECL', '', 'DECLINED', { username: '', display_name: '' }),
    ],
  });
  const list = buildParticipants([e]);
  assert.deepEqual(names(list.eligible), ['solo_user']);
  // El DECLINED sin nombre no genera aviso: igual no participaría.
  assert.equal(list.nameless.length, 1);
  assert.equal(entryLabel(list.nameless[0]), '(sin nombre) …1234');
});

test('displayName', () => {
  assert.equal(displayName({ display_name: ' Fe ', username: 'x' }), 'Fe');
  assert.equal(displayName({ display_name: '', username: 'x' }), 'x');
  assert.equal(displayName({}), '');
});

test('bloqueados: por usuario, nombre visible o ID, sin importar mayúsculas, tildes ni @', () => {
  const e = ev({
    members: [
      member('A', '', 'CHECKED_IN', { username: 'samuraibounce', display_name: 'Felipeee' }),
      member('B', 'José'),
      member('C', 'Carla'),
      member('D', 'Dario'),
    ],
  });
  const list = buildParticipants([e], { blocked: ['@SamuraiBounce', 'jose', 'E:C'] });
  assert.deepEqual(names(list.eligible), ['Dario']);
  assert.equal(list.counts.byReason.blocked, 3);
  assert.equal(blockedMatcher([])({ username: 'x' }), false);
});

test('quitar a mano en la revisión', () => {
  const list = buildParticipants([ev()], { removed: ['E:BETO'] });
  assert.deepEqual(names(list.eligible), ['Ana']);
  assert.equal(reasonOf(list, 'Beto'), 'removed');
});

test('un motivo más fuerte tapa a los demás (DECLINED antes que bloqueado)', () => {
  const list = buildParticipants([ev()], { blocked: ['Dani'], removed: ['E:DANI'] });
  assert.equal(reasonOf(list, 'Dani'), 'declined');
});

test('canCloseList: sin nombre pide confirmación; lista vacía no se puede cerrar', () => {
  const withNameless = buildParticipants([ev({ members: [member('A', 'Ana'), member('B', '')] })]);
  assert.deepEqual(canCloseList(withNameless), { ok: false, problem: 'nameless', count: 1 });
  assert.deepEqual(canCloseList(withNameless, { ignoreNameless: true }), { ok: true, problem: null, count: 1 });

  const empty = buildParticipants([ev({ members: [member('A', 'Ana', 'DECLINED')] })]);
  assert.deepEqual(canCloseList(empty), { ok: false, problem: 'empty', count: 0 });
});

test('closeList congela el pozo y guarda el resumen para la auditoría', () => {
  const list = buildParticipants([ev({ members: [...rawEvent().members, member('Z', '')] })], { removed: ['E:BETO'] });
  assert.equal(closeList(list).ok, false);
  const now = new Date('2026-10-11T15:00:00Z');
  const r = closeList(list, { ignoreNameless: true, now });
  assert.equal(r.ok, true);
  const { closed } = r;
  assert.deepEqual(closed.pool.map((p) => p.name), ['Ana']);
  assert.deepEqual(Object.keys(closed.pool[0]).sort(), ['eventIds', 'key', 'memberId', 'name', 'username']);
  assert.equal(closed.closedAt, '2026-10-11T15:00:00.000Z');
  assert.deepEqual(closed.removedNames, ['Beto']);
  assert.equal(closed.ignoredNameless, 1);
  assert.equal(closed.excludedByReason.creator, 1);
  assert.ok(Object.isFrozen(closed.pool) && Object.isFrozen(closed.pool[0]));
});

test('modo manual: limpia viñetas/números, deduplica y respeta bloqueados y quitados', () => {
  const text = '1. Ana\n- beto\n• Carla\n\n  ana  \nBeto\n3) Dario\nEva';
  const list = buildManualParticipants(text, { blocked: ['dario'], removed: ['manual:eva'] });
  assert.deepEqual(names(list.eligible), ['Ana', 'beto', 'Carla']);
  assert.equal(list.merged, 2);
  assert.equal(reasonOf(list, 'Dario'), 'blocked');
  assert.equal(reasonOf(list, 'Eva'), 'removed');
  assert.equal(list.source, 'manual');
});

test('modo manual sin "una por miembro" deja nombres repetidos como entradas distintas', () => {
  const list = buildManualParticipants('Ana\nAna\nBeto', { filters: { onePerMember: false } });
  assert.deepEqual(names(list.eligible), ['Ana', 'Ana', 'Beto']);
  assert.equal(new Set(list.eligible.map((e) => e.key)).size, 3);
});

test('modo manual con texto vacío o gigante', () => {
  assert.equal(buildManualParticipants('').eligible.length, 0);
  const big = Array.from({ length: 5001 }, (_, i) => `P${i}`).join('\n');
  const list = buildManualParticipants(big);
  assert.equal(list.truncated, true);
  assert.equal(list.eligible.length, 5000);
});
