// Sorteo con crypto.getRandomValues, sin sesgo de módulo.
// El estado es inmutable: cada acción devuelve un estado nuevo, así la UI
// puede ir revelando de a uno ("uno por uno") o todo junto ("Top N").
// Sacar de a uno al azar entre los que quedan da exactamente la misma
// probabilidad que mezclar todo con Fisher-Yates y leer en orden.

export class RaffleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RaffleError';
    this.code = code;
  }
}

const UINT32_RANGE = 2 ** 32;

export function cryptoFill(array) {
  return globalThis.crypto.getRandomValues(array);
}

/**
 * Entero uniforme en [0, max). Descarta los valores del final del rango
 * que harían que algunos resultados salgan más seguido (rejection sampling).
 */
export function randomInt(max, fill = cryptoFill) {
  if (!Number.isInteger(max) || max < 1 || max > UINT32_RANGE) {
    throw new RangeError(`randomInt: max inválido (${max})`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % max);
  const buf = new Uint32Array(1);
  for (;;) {
    fill(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/** Fisher-Yates: devuelve una copia mezclada. */
export function shuffle(items, fill = cryptoFill) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1, fill);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toCount(value, name, min) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new RaffleError('invalidConfig', `La cantidad de ${name} tiene que ser un número entero mayor o igual a ${min}.`);
  }
  return n;
}

/**
 * Prepara un sorteo sobre una lista cerrada (salida de closeList().closed).
 * Si se piden más suplentes de los que alcanzan, se usan los que haya.
 */
export function createDraw(closed, { winners, alternates = 0 } = {}, { now = new Date(), attempt = 1 } = {}) {
  const pool = closed?.pool ?? [];
  if (!pool.length) throw new RaffleError('emptyPool', 'No hay participantes para sortear.');
  const w = toCount(winners, 'premios', 1);
  const a = toCount(alternates, 'suplentes', 0);
  if (w > pool.length) {
    throw new RaffleError('tooManyWinners', `Hay ${pool.length} participantes: no alcanza para ${w} premios.`);
  }
  return Object.freeze({
    closed,
    config: Object.freeze({ winners: w, alternates: Math.min(a, pool.length - w), requestedAlternates: a }),
    attempt,
    startedAt: now.toISOString(),
    remaining: Object.freeze(pool.map((p) => p.key)),
    winners: Object.freeze([]),
    alternates: Object.freeze([]),
    replaced: Object.freeze([]),
    log: Object.freeze([]),
  });
}

const byKey = (state, key) => state.closed.pool.find((p) => p.key === key);
export const drawsNeeded = (state) => state.config.winners + state.config.alternates;
const initialDraws = (state) => state.log.filter((e) => e.type === 'draw' && !e.replacing).length;
// También termina si ya no queda nadie (pasa si los reemplazos se comieron el pozo).
export const isComplete = (state) => initialDraws(state) >= drawsNeeded(state) || !state.remaining.length;
export const winnersComplete = (state) => initialDraws(state) >= state.config.winners;

function pickFromRemaining(state, fill) {
  if (!state.remaining.length) return null;
  const idx = randomInt(state.remaining.length, fill);
  const key = state.remaining[idx];
  return { key, remaining: state.remaining.filter((_, i) => i !== idx) };
}

/**
 * Saca el próximo: primero completa los premios (1°, 2°, ...) y después los suplentes.
 * @returns {{state: object, drawn: {role: 'winner'|'alternate', position: number, entry: object}}}
 */
export function drawNext(state, { fill = cryptoFill, now = new Date() } = {}) {
  if (isComplete(state)) throw new RaffleError('complete', 'El sorteo ya está completo.');
  const pick = pickFromRemaining(state, fill);
  const entry = byKey(state, pick.key);
  const role = winnersComplete(state) ? 'alternate' : 'winner';
  const list = role === 'winner' ? state.winners : state.alternates;
  const position = list.length + 1;
  const logEntry = Object.freeze({ type: 'draw', role, position, key: entry.key, name: entry.name, at: now.toISOString() });
  const next = Object.freeze({
    ...state,
    remaining: Object.freeze(pick.remaining),
    winners: role === 'winner' ? Object.freeze([...state.winners, entry]) : state.winners,
    alternates: role === 'alternate' ? Object.freeze([...state.alternates, entry]) : state.alternates,
    log: Object.freeze([...state.log, logEntry]),
  });
  return { state: next, drawn: { role, position, entry } };
}

/** Saca todo lo que falta de una vez (modo "Top N"). Devuelve el estado final y lo sorteado en orden. */
export function drawAll(state, options = {}) {
  let current = state;
  const drawn = [];
  while (!isComplete(current)) {
    const r = drawNext(current, options);
    current = r.state;
    drawn.push(r.drawn);
  }
  return { state: current, drawn };
}

/**
 * Excluye a un ganador (no se presentó, ya ganó otro premio, etc.) y lo reemplaza
 * en el mismo puesto por el primer suplente. Si no hay suplentes, se sortea uno
 * nuevo entre los que quedan.
 */
export function replaceWinner(state, key, { reason = '', fill = cryptoFill, now = new Date() } = {}) {
  const index = state.winners.findIndex((w) => w.key === key);
  if (index === -1) throw new RaffleError('notWinner', 'Esa persona no está entre los ganadores.');
  const out = state.winners[index];
  let replacement;
  let remaining = state.remaining;
  let alternates = state.alternates;
  let from;

  if (alternates.length) {
    [replacement] = alternates;
    alternates = Object.freeze(alternates.slice(1));
    from = 'alternate';
  } else {
    const pick = pickFromRemaining(state, fill);
    if (!pick) throw new RaffleError('noReplacement', 'No quedan suplentes ni participantes para reemplazarlo.');
    replacement = byKey(state, pick.key);
    remaining = Object.freeze(pick.remaining);
    from = 'pool';
  }

  const at = now.toISOString();
  const position = index + 1;
  const newLog = [...state.log];
  if (from === 'pool') {
    newLog.push(Object.freeze({ type: 'draw', role: 'winner', position, key: replacement.key, name: replacement.name, at, replacing: out.key }));
  }
  newLog.push(Object.freeze({
    type: 'replace', position, outKey: out.key, outName: out.name, inKey: replacement.key, inName: replacement.name, from, reason, at,
  }));

  const winners = [...state.winners];
  winners[index] = replacement;
  return Object.freeze({
    ...state,
    remaining,
    winners: Object.freeze(winners),
    alternates,
    replaced: Object.freeze([...state.replaced, Object.freeze({ position, out, in: replacement, from, reason, at })]),
    log: Object.freeze(newLog),
  });
}

/** Vuelve a sortear desde cero con la misma lista cerrada y la misma configuración. */
export function repeatDraw(state, { now = new Date() } = {}) {
  return createDraw(
    state.closed,
    { winners: state.config.winners, alternates: state.config.requestedAlternates },
    { now, attempt: state.attempt + 1 },
  );
}
