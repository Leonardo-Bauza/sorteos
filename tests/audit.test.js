import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../js/api.js';
import { buildParticipants, buildManualParticipants, closeList } from '../js/participants.js';
import { createDraw, drawAll, replaceWinner } from '../js/raffle.js';
import { buildAudit, formatResultsText, formatDateTime, listFingerprint, exclusionSummary } from '../js/audit.js';
import { rawEvent, member, EVENT_ID } from './fixtures.js';

const zero = (arr) => { arr[0] = 0; return arr; };
const T0 = new Date('2026-10-11T18:05:00Z');

function scenario() {
  const event = normalizeEvent(rawEvent({
    members: [
      member('CREATOR', 'Organiza'),
      member('ANA', 'Ana'), member('BETO', 'Beto'), member('CAMI', 'Cami'),
      member('DANI', 'Dani'), member('EVA', 'Eva'),
      member('FER', 'Fer', 'ACCEPTED'), member('GABI', 'Gabi', 'DECLINED'),
    ],
  }));
  const list = buildParticipants([event], { removed: ['E:EVA'] });
  const { closed } = closeList(list, { now: T0 });
  let { state } = drawAll(createDraw(closed, { winners: 2, alternates: 1 }, { now: T0 }), { fill: zero, now: T0 });
  state = replaceWinner(state, state.winners[1].key, { reason: 'No se presentó', now: T0 });
  return { event, closed, state };
}

test('buildAudit junta eventos, filtros, lista y orden del sorteo', async () => {
  const { event, closed, state } = scenario();
  const fingerprint = await listFingerprint(closed.pool);
  const audit = buildAudit({ events: [event], closed, draw: state, mode: 'all', fingerprint, now: T0 });

  assert.deepEqual(audit.events, [{ id: EVENT_ID, name: event.name, url: event.url, time: event.time }]);
  assert.deepEqual(audit.filters, { checkedInOnly: true, onePerMember: true, includeCreator: false });
  assert.equal(audit.list.participants, 4);
  assert.deepEqual(audit.list.participantNames, ['Ana', 'Beto', 'Cami', 'Dani']);
  assert.deepEqual(audit.list.excludedByReason, { creator: 1, removed: 1, notCheckedIn: 1, declined: 1 });
  assert.deepEqual(audit.list.removedNames, ['Eva']);
  assert.equal(audit.list.fingerprint, fingerprint);
  assert.equal(audit.draw.mode, 'all');
  assert.deepEqual(audit.draw.order.map((o) => [o.n, o.role, o.position, o.name]), [
    [1, 'winner', 1, 'Ana'], [2, 'winner', 2, 'Beto'], [3, 'alternate', 1, 'Cami'],
  ]);
  assert.deepEqual(audit.draw.winners, [{ position: 1, name: 'Ana' }, { position: 2, name: 'Cami' }]);
  assert.deepEqual(audit.draw.alternatesList, []);
  assert.deepEqual(audit.draw.replacements, [{
    position: 2, out: 'Beto', in: 'Cami', from: 'alternate', reason: 'No se presentó', at: T0.toISOString(),
  }]);
  // Se puede guardar como JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(audit)), audit);
});

test('formatResultsText: texto listo para WhatsApp/Discord', async () => {
  const { event, closed, state } = scenario();
  const audit = buildAudit({ events: [event], closed, draw: state, mode: 'all', fingerprint: 'abcdef0123456789', now: T0 });
  assert.equal(formatResultsText(audit), [
    '🎉 Sorteo Pokémon GO Caseros',
    `📍 ${event.name}`,
    '📅 dom, 11/10/2026, 15:05 (hora Argentina)',
    '',
    '🏆 Ganadores',
    '🥇 1. Ana',
    '🥈 2. Cami',
    '',
    '🔄 Reemplazos',
    '• Puesto 2: sale Beto (No se presentó) → entra Cami',
    '',
    '👥 4 participantes · solo con check-in · sin el creador · una entrada por persona',
    '🔒 Intento 1 · lista #abcdef01',
    'Datos vía cmpf-tools.de (topi314)',
  ].join('\n'));
});

test('formatResultsText en modo manual con Top 5 y suplentes', () => {
  const list = buildManualParticipants('A\nB\nC\nD\nE\nF\nG', { filters: { onePerMember: false } });
  const { closed } = closeList(list, { now: T0 });
  const { state } = drawAll(createDraw(closed, { winners: 5, alternates: 1 }, { now: T0 }), { fill: zero });
  const text = formatResultsText(buildAudit({ closed, draw: state, mode: 'oneByOne', now: T0 }));
  assert.match(text, /📝 Lista cargada a mano/);
  assert.match(text, /🥉 3\. C\n🎁 4\. D\n🎁 5\. E/);
  assert.match(text, /🔁 Suplentes\n1\. F/);
  assert.match(text, /👥 7 participantes · nombres repetidos cuentan doble/);
  assert.doesNotMatch(text, /cmpf-tools|lista #/);
});

test('listFingerprint no depende del orden y cambia si cambia una persona', async () => {
  const a = [{ key: 'k1', name: 'Ana' }, { key: 'k2', name: 'Beto' }];
  const fp = await listFingerprint(a);
  assert.match(fp, /^[0-9a-f]{64}$/);
  assert.equal(await listFingerprint([...a].reverse()), fp);
  assert.notEqual(await listFingerprint([a[0], { key: 'k3', name: 'Beto' }]), fp);
});

test('formatDateTime en hora de Argentina y tolerante a fechas inválidas', () => {
  assert.equal(formatDateTime('2026-10-11T18:05:00Z'), 'dom, 11/10/2026, 15:05');
  assert.equal(formatDateTime(''), '');
  assert.equal(formatDateTime('nope'), '');
});

test('exclusionSummary usa etiquetas en español', () => {
  assert.deepEqual(exclusionSummary({ declined: 2, creator: 1, removed: 0 }), [
    'Rechazó la invitación: 2', 'Creador del evento: 1',
  ]);
});
