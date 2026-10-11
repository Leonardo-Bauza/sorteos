import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomInt, shuffle, createDraw, drawNext, drawAll, replaceWinner, repeatDraw,
  isComplete, winnersComplete, RaffleError,
} from '../js/raffle.js';

// "Azar" controlado: devuelve los valores dados en orden (y después 0 para siempre).
function seq(values = []) {
  let i = 0;
  const fill = (arr) => { arr[0] = i < values.length ? values[i] : 0; i += 1; return arr; };
  fill.calls = () => i;
  return fill;
}
const zero = () => seq();

function closedPool(n) {
  const names = Array.from({ length: n }, (_, i) => `P${i + 1}`);
  return { pool: names.map((name) => ({ key: `k${name}`, memberId: `E:${name}`, name, username: name, eventIds: [] })) };
}
const NOW = new Date('2026-10-11T18:00:00Z');
const winnerNames = (s) => s.winners.map((w) => w.name);
const altNames = (s) => s.alternates.map((w) => w.name);

test('randomInt descarta los valores que generarían sesgo', () => {
  // 2^32 % 3 === 1, así que 4294967295 se descarta.
  const fill = seq([4294967295, 5]);
  assert.equal(randomInt(3, fill), 2);
  assert.equal(fill.calls(), 2);
  // Potencia de 2: no se descarta nada.
  assert.equal(randomInt(4, seq([4294967295])), 3);
  assert.equal(randomInt(1, seq([123])), 0);
});

test('randomInt valida el rango', () => {
  for (const bad of [0, -1, 1.5, NaN, 2 ** 32 + 1]) assert.throws(() => randomInt(bad), RangeError);
});

test('randomInt con crypto real es uniforme (chequeo estadístico amplio)', () => {
  const counts = [0, 0, 0];
  for (let i = 0; i < 30000; i += 1) counts[randomInt(3)] += 1;
  // Esperado 10000 ± ~82 (1 desvío): margen de ±600 (>7 desvíos).
  for (const c of counts) assert.ok(c > 9400 && c < 10600, `conteos: ${counts}`);
});

test('shuffle con crypto real: las 24 permutaciones de 4 salen parecido', () => {
  const counts = new Map();
  for (let i = 0; i < 24000; i += 1) {
    const k = shuffle([1, 2, 3, 4]).join('');
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.size, 24);
  // Esperado 1000 ± ~31: margen de ±250.
  for (const [k, c] of counts) assert.ok(c > 750 && c < 1250, `${k}: ${c}`);
});

test('shuffle no modifica el original y conserva los elementos', () => {
  const orig = [1, 2, 3, 4, 5];
  const out = shuffle(orig);
  assert.deepEqual(orig, [1, 2, 3, 4, 5]);
  assert.deepEqual([...out].sort(), orig);
  assert.deepEqual(shuffle([]), []);
});

test('createDraw valida la configuración', () => {
  assert.throws(() => createDraw({ pool: [] }, { winners: 1 }), (e) => e.code === 'emptyPool');
  assert.throws(() => createDraw(closedPool(3), { winners: 0 }), (e) => e.code === 'invalidConfig');
  assert.throws(() => createDraw(closedPool(3), { winners: 1.5 }), (e) => e.code === 'invalidConfig');
  assert.throws(() => createDraw(closedPool(3), { winners: 1, alternates: -1 }), (e) => e.code === 'invalidConfig');
  assert.throws(() => createDraw(closedPool(3), { winners: 4 }), (e) => e.code === 'tooManyWinners' && e instanceof RaffleError);
  // Strings de un <input type=number> también valen.
  assert.equal(createDraw(closedPool(3), { winners: '2' }).config.winners, 2);
});

test('si no alcanzan los suplentes pedidos, usa los que haya', () => {
  const s = createDraw(closedPool(5), { winners: 3, alternates: 4 });
  assert.deepEqual(s.config, { winners: 3, alternates: 2, requestedAlternates: 4 });
});

test('uno por uno: primero los premios en orden, después los suplentes', () => {
  let s = createDraw(closedPool(6), { winners: 2, alternates: 2 }, { now: NOW });
  const fill = seq([2, 0, 3, 1]);
  const roles = [];
  while (!isComplete(s)) {
    const r = drawNext(s, { fill, now: NOW });
    s = r.state;
    roles.push(`${r.drawn.role}#${r.drawn.position}:${r.drawn.entry.name}`);
  }
  // remaining: P1..P6 -> idx2=P3 | P1,P2,P4,P5,P6 -> idx0=P1 | P2,P4,P5,P6 -> idx3=P6 | P2,P4,P5 -> idx1=P4
  assert.deepEqual(roles, ['winner#1:P3', 'winner#2:P1', 'alternate#1:P6', 'alternate#2:P4']);
  assert.deepEqual(s.remaining, ['kP2', 'kP5']);
  assert.equal(s.log.length, 4);
  assert.equal(s.log[0].at, NOW.toISOString());
  assert.throws(() => drawNext(s), (e) => e.code === 'complete');
});

test('Top N de una vez: sin repetidos y todos del pozo', () => {
  const s0 = createDraw(closedPool(30), { winners: 14, alternates: 3 });
  const { state, drawn } = drawAll(s0);
  assert.equal(state.winners.length, 14);
  assert.equal(state.alternates.length, 3);
  assert.equal(drawn.length, 17);
  const keys = [...state.winners, ...state.alternates].map((e) => e.key);
  assert.equal(new Set(keys).size, 17);
  assert.equal(state.remaining.length, 13);
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.winners));
  // El estado original no cambió.
  assert.equal(s0.winners.length, 0);
});

test('sortear a todos los participantes como premios', () => {
  const { state } = drawAll(createDraw(closedPool(10), { winners: 10 }));
  assert.equal(new Set(state.winners.map((w) => w.key)).size, 10);
});

test('reemplazar un ganador por el primer suplente, en el mismo puesto', () => {
  let { state } = drawAll(createDraw(closedPool(6), { winners: 3, alternates: 2 }), { fill: zero() });
  assert.deepEqual(winnerNames(state), ['P1', 'P2', 'P3']);
  assert.deepEqual(altNames(state), ['P4', 'P5']);

  state = replaceWinner(state, 'kP2', { reason: 'No estaba', now: NOW });
  assert.deepEqual(winnerNames(state), ['P1', 'P4', 'P3']);
  assert.deepEqual(altNames(state), ['P5']);
  assert.equal(state.replaced[0].out.name, 'P2');
  assert.equal(state.replaced[0].from, 'alternate');
  assert.deepEqual(state.log.at(-1), {
    type: 'replace', position: 2, outKey: 'kP2', outName: 'P2', inKey: 'kP4', inName: 'P4',
    from: 'alternate', reason: 'No estaba', at: NOW.toISOString(),
  });
});

test('sin suplentes, el reemplazo se sortea entre los que quedan', () => {
  let { state } = drawAll(createDraw(closedPool(4), { winners: 2 }), { fill: zero() });
  state = replaceWinner(state, 'kP1', { fill: seq([1]) }); // quedan P3,P4 -> idx1 = P4
  assert.deepEqual(winnerNames(state), ['P4', 'P2']);
  assert.equal(state.replaced[0].from, 'pool');
  assert.deepEqual(state.remaining, ['kP3']);
  // El ganador excluido no vuelve a salir.
  state = replaceWinner(state, 'kP4');
  assert.deepEqual(winnerNames(state), ['P3', 'P2']);
  assert.throws(() => replaceWinner(state, 'kP3'), (e) => e.code === 'noReplacement');
  assert.throws(() => replaceWinner(state, 'kP1'), (e) => e.code === 'notWinner');
});

test('reemplazar en medio del uno por uno no altera la cuenta de premios', () => {
  let s = createDraw(closedPool(6), { winners: 3, alternates: 1 });
  s = drawNext(s, { fill: zero() }).state; // P1
  s = replaceWinner(s, 'kP1', { fill: zero() }); // entra P2 en el puesto 1
  assert.equal(winnersComplete(s), false);
  const r = drawNext(s, { fill: zero() });
  assert.deepEqual([r.drawn.role, r.drawn.position, r.drawn.entry.name], ['winner', 2, 'P3']);
  const { state } = drawAll(r.state, { fill: zero() });
  assert.deepEqual(winnerNames(state), ['P2', 'P3', 'P4']);
  assert.deepEqual(altNames(state), ['P5']);
});

test('si los reemplazos se comen el pozo, el sorteo termina con lo que hay', () => {
  let s = createDraw(closedPool(3), { winners: 3 });
  s = drawNext(s, { fill: zero() }).state;
  s = replaceWinner(s, 'kP1', { fill: zero() });
  const { state } = drawAll(s, { fill: zero() });
  assert.equal(isComplete(state), true);
  assert.deepEqual(winnerNames(state), ['P2', 'P3']);
});

test('repetir sorteo: arranca de cero con la misma lista y suma un intento', () => {
  const { state } = drawAll(createDraw(closedPool(5), { winners: 2, alternates: 9 }));
  const again = repeatDraw(state, { now: NOW });
  assert.equal(again.attempt, 2);
  assert.equal(again.winners.length, 0);
  assert.equal(again.remaining.length, 5);
  assert.equal(again.config.requestedAlternates, 9);
  assert.equal(again.closed, state.closed);
});
