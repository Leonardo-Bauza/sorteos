import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadBlocked, saveBlocked, parseBlockedText, normalizeBlockedList,
  loadPrefs, savePrefs, DEFAULT_PREFS, MAX_BLOCKED,
} from '../js/storage.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    raw: data,
  };
}
const brokenStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

test('guarda y recupera la lista de bloqueados', () => {
  const s = memoryStorage();
  const r = saveBlocked(['Pepe', '  @pepe ', '', 'Juana'], s);
  assert.deepEqual(r, { saved: true, list: ['Pepe', 'Juana'] });
  assert.deepEqual(loadBlocked(s), ['Pepe', 'Juana']);
});

test('parseBlockedText: uno por línea', () => {
  assert.deepEqual(parseBlockedText('Pepe\r\n\n  Juana  \nPEPE'), ['Pepe', 'Juana']);
  assert.deepEqual(parseBlockedText(undefined), []);
});

test('normalizeBlockedList descarta basura y respeta el tope', () => {
  assert.deepEqual(normalizeBlockedList(['a', 3, null, { x: 1 }, 'b']), ['a', 'b']);
  assert.deepEqual(normalizeBlockedList('no es array'), []);
  const many = Array.from({ length: MAX_BLOCKED + 10 }, (_, i) => `u${i}`);
  assert.equal(normalizeBlockedList(many).length, MAX_BLOCKED);
});

test('datos corruptos o ausentes en storage no rompen nada', () => {
  assert.deepEqual(loadBlocked(memoryStorage({ 'sorteos-caseros:v1:blocked': '{no json' })), []);
  assert.deepEqual(loadBlocked(memoryStorage({ 'sorteos-caseros:v1:blocked': '{"a":1}' })), []);
  assert.deepEqual(loadBlocked(memoryStorage()), []);
  assert.deepEqual(loadBlocked(null), []);
});

test('si localStorage falla (modo privado / sin espacio) avisa que no guardó', () => {
  assert.deepEqual(loadBlocked(brokenStorage), []);
  assert.deepEqual(saveBlocked(['Pepe'], brokenStorage), { saved: false, list: ['Pepe'] });
  assert.deepEqual(saveBlocked(['Pepe'], null), { saved: false, list: ['Pepe'] });
  assert.deepEqual(loadPrefs(brokenStorage), DEFAULT_PREFS);
});

test('preferencias: cantidad de premios, suplentes y modo de revelado', () => {
  const s = memoryStorage();
  assert.deepEqual(loadPrefs(s), { winners: 1, alternates: 0, mode: 'oneByOne' });
  assert.equal(savePrefs({ winners: 14, alternates: 3, mode: 'all', filters: { x: 1 } }, s).saved, true);
  assert.deepEqual(loadPrefs(s), { winners: 14, alternates: 3, mode: 'all' });
});

test('preferencias inválidas vuelven a los valores por defecto', () => {
  const s = memoryStorage({ 'sorteos-caseros:v1:prefs': JSON.stringify({ winners: 0, alternates: -2, mode: 'otro' }) });
  assert.deepEqual(loadPrefs(s), DEFAULT_PREFS);
  assert.deepEqual(savePrefs({ winners: '3', alternates: 1.5 }, memoryStorage()).prefs, DEFAULT_PREFS);
});
