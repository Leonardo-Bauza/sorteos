import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEvent, fetchEvents, normalizeEvent, ApiError, API_BASE, MAX_MEMBERS } from '../js/api.js';
import { rawEvent, jsonResponse, textResponse, EVENT_ID, EVENT_ID_2 } from './fixtures.js';

const NOT_FOUND = 'Failed to get events for export: failed to fetch events: failed to fetch event "x": graphql errors: Error: error checking permissions for event x: row not found: row not found, Path: event';
const INVALID_URL = 'Failed to get events for export: ... invalid event URL. Must start with ...';

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err instanceof ApiError && err.code === code);
}

test('arma la URL con un evento por pedido, sin credenciales ni referrer', async () => {
  let called;
  const fetchImpl = async (url, init) => { called = { url, init }; return jsonResponse([rawEvent()]); };
  await fetchEvent('https://cmpf.re/99Lldn', { fetchImpl });
  assert.equal(called.url, `${API_BASE}/api/events?events=https%3A%2F%2Fcmpf.re%2F99Lldn`);
  assert.equal(called.init.method, 'GET');
  assert.equal(called.init.credentials, 'omit');
  assert.equal(called.init.referrerPolicy, 'no-referrer');
});

test('normaliza el evento y descarta campos que no usamos', async () => {
  const ev = await fetchEvent(EVENT_ID, { fetchImpl: async () => jsonResponse([rawEvent()]) });
  assert.equal(ev.id, EVENT_ID);
  assert.equal(ev.url, `https://campfire.scopely.com/discover/meetup/${EVENT_ID}`);
  assert.deepEqual(ev.creator, { id: 'E:CREATOR', username: 'organiza', display_name: 'Organiza' });
  assert.equal(ev.members.length, 5);
  assert.deepEqual(Object.keys(ev.members[0]).sort(), ['display_name', 'id', 'rsvp_status', 'username']);
  assert.equal('lat' in ev, false);
});

test('normalizeEvent tolera campos faltantes o con tipos raros', () => {
  const ev = normalizeEvent({
    id: 'no-uuid',
    members: [
      { id: 'E:1', username: null, display_name: undefined, rsvp_status: 'checked_in' },
      { username: 'sin id' },
      null,
    ],
  });
  assert.equal(ev.name, '(evento sin nombre)');
  assert.equal(ev.url, '');
  assert.deepEqual(ev.creator, { id: '', username: '', display_name: '' });
  assert.deepEqual(ev.members, [{ id: 'E:1', username: '', display_name: '', rsvp_status: 'CHECKED_IN' }]);
  assert.throws(() => normalizeEvent({ name: 'sin id' }), ApiError);
});

test('normalizeEvent pone un tope a la cantidad de miembros', () => {
  const members = Array.from({ length: MAX_MEMBERS + 50 }, (_, i) => ({ id: `E:${i}`, username: `u${i}`, display_name: '', rsvp_status: 'CHECKED_IN' }));
  assert.equal(normalizeEvent(rawEvent({ members })).members.length, MAX_MEMBERS);
});

test('normalizeEvent limpia caracteres de control y marcas bidi en los nombres', () => {
  const ev = normalizeEvent(rawEvent({
    members: [{ id: 'E:1', username: 'a‮b', display_name: ' Nom\nbre\u0000 ', rsvp_status: 'CHECKED_IN' }],
  }));
  assert.equal(ev.members[0].username, 'a b');
  assert.equal(ev.members[0].display_name, 'Nom bre');
});

test('mapea los errores reales de la API', async () => {
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => textResponse(NOT_FOUND, 500) }), 'notFound');
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => textResponse(INVALID_URL, 500) }), 'invalidLink');
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => textResponse("Missing or empty 'events' parameter", 400) }), 'badRequest');
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => textResponse('boom', 500) }), 'server');
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => textResponse('Bad Gateway', 502) }), 'server');
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => textResponse('slow down', 429) }), 'rateLimited');
});

test('respuestas inesperadas', async () => {
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => textResponse('<html>', 200) }), 'badResponse');
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => jsonResponse({ id: 1 }) }), 'badResponse');
  await rejectsWith(fetchEvent('x', { fetchImpl: async () => jsonResponse([]) }), 'notFound');
});

test('error de red (incluye un bloqueo de CORS) sugiere modo manual', async () => {
  const p = fetchEvent('x', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(p, (err) => err.code === 'network' && err.suggestManual === true);
});

// fetch falso que solo termina cuando lo abortan (como el real, falla al toque si ya viene abortado)
const hangingFetch = (_url, { signal }) => new Promise((_, reject) => {
  const fail = () => reject(new DOMException('Aborted', 'AbortError'));
  if (signal.aborted) fail();
  else signal.addEventListener('abort', fail);
});

test('corta por timeout', async () => {
  await rejectsWith(fetchEvent('x', { fetchImpl: hangingFetch, timeoutMs: 20 }), 'timeout');
});

test('se puede cancelar desde afuera', async () => {
  const ctrl = new AbortController();
  const p = fetchEvent('x', { fetchImpl: hangingFetch, signal: ctrl.signal, timeoutMs: 5000 });
  ctrl.abort();
  await rejectsWith(p, 'aborted');
  const already = AbortSignal.abort();
  await rejectsWith(fetchEvent('x', { fetchImpl: hangingFetch, signal: already }), 'aborted');
});

test('fetchEvents informa qué link falló sin perder los demás', async () => {
  const fetchImpl = async (url) => {
    if (url.includes(EVENT_ID)) return jsonResponse([rawEvent()]);
    if (url.includes(EVENT_ID_2)) return jsonResponse([rawEvent({ id: EVENT_ID_2 })]);
    return textResponse(NOT_FOUND, 500);
  };
  const r = await fetchEvents([
    { input: 'link1', query: EVENT_ID },
    { input: 'link-malo', query: '00000000-0000-4000-8000-000000000000' },
    { input: 'link2', query: EVENT_ID_2 },
  ], { fetchImpl });
  assert.deepEqual(r.events.map((e) => e.id), [EVENT_ID, EVENT_ID_2]);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].input, 'link-malo');
  assert.equal(r.failures[0].error.code, 'notFound');
});

test('fetchEvents descarta eventos repetidos (link corto + UUID del mismo evento)', async () => {
  const fetchImpl = async () => jsonResponse([rawEvent()]);
  const r = await fetchEvents([
    { input: 'https://cmpf.re/abc', query: 'https://cmpf.re/abc' },
    { input: EVENT_ID, query: EVENT_ID },
  ], { fetchImpl });
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.repeated, [EVENT_ID]);
});
