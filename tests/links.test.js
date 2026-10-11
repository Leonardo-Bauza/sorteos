import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventToken, parseEventInput, REASONS, MAX_EVENTS } from '../js/links.js';

const UUID = 'e4b55fb3-96ff-48ee-b30d-43b163b51551';

test('acepta un UUID suelto y lo normaliza a minúsculas', () => {
  assert.deepEqual(parseEventToken(UUID.toUpperCase()), { ok: true, kind: 'uuid', key: UUID, query: UUID });
});

test('acepta los tres dominios de meetup y extrae el UUID', () => {
  for (const url of [
    `https://campfire.nianticlabs.com/discover/meetup/${UUID}`,
    `https://campfire.scopely.com/discover/meetup/${UUID}`,
    `https://niantic-social.nianticlabs.com/public/meetup/${UUID}`,
  ]) {
    const r = parseEventToken(url);
    assert.equal(r.ok, true, url);
    assert.equal(r.query, UUID);
  }
});

test('tolera barra final, query string, falta de https y puntuación pegada', () => {
  for (const url of [
    `https://campfire.scopely.com/discover/meetup/${UUID}/`,
    `https://campfire.scopely.com/discover/meetup/${UUID}?utm_source=x#top`,
    `campfire.nianticlabs.com/discover/meetup/${UUID}`,
    `(https://campfire.scopely.com/discover/meetup/${UUID}).`,
    `HTTPS://CAMPFIRE.SCOPELY.COM/discover/meetup/${UUID}`,
  ]) {
    assert.equal(parseEventToken(url).query, UUID, url);
  }
});

test('el link corto cmpf.re se manda normalizado a la API', () => {
  assert.deepEqual(parseEventToken('cmpf.re/99Lldn/'), {
    ok: true, kind: 'short', key: 'https://cmpf.re/99Lldn', query: 'https://cmpf.re/99Lldn',
  });
});

test('rechaza otros sitios', () => {
  for (const url of [
    `https://example.com/discover/meetup/${UUID}`,
    `https://campfire.scopely.com.evil.com/discover/meetup/${UUID}`,
    `https://evilcampfire.scopely.com/discover/meetup/${UUID}`,
  ]) {
    assert.deepEqual(parseEventToken(url), { ok: false, reason: REASONS.otherSite }, url);
  }
});

test('rechaza links de Campfire que no son eventos', () => {
  for (const url of [
    'https://campfire.scopely.com/discover/club/abc',
    'https://campfire.scopely.com/discover/meetup/no-es-uuid',
    'https://cmpf.re/',
    'https://cmpf.re/a/b',
    `ftp://campfire.scopely.com/discover/meetup/${UUID}`,
    `https://user:pass@campfire.scopely.com/discover/meetup/${UUID}`,
    `https://campfire.scopely.com:8443/discover/meetup/${UUID}`,
  ]) {
    assert.deepEqual(parseEventToken(url), { ok: false, reason: REASONS.notEvent }, url);
  }
});

test('rechaza texto que no es link', () => {
  for (const t of ['hola123', 'javascript:alert(1)', '<script>', '']) {
    assert.deepEqual(parseEventToken(t), { ok: false, reason: REASONS.notLink }, t);
  }
  assert.deepEqual(parseEventToken('x'.repeat(301)), { ok: false, reason: REASONS.tooLong });
});

test('parseEventInput separa por espacios, líneas, comas y punto y coma', () => {
  const other = '11111111-2222-4333-8444-555555555555';
  const r = parseEventInput(` ${UUID},\nhttps://cmpf.re/abc ; ${other}\n\n`);
  assert.deepEqual(r.events.map((e) => e.query), [UUID, 'https://cmpf.re/abc', other]);
  assert.deepEqual(r.invalid, []);
  assert.equal(r.withinLimit, true);
});

test('parseEventInput deduplica el mismo evento escrito de distintas formas', () => {
  const r = parseEventInput(`${UUID} https://campfire.scopely.com/discover/meetup/${UUID.toUpperCase()}`);
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.duplicates, [`https://campfire.scopely.com/discover/meetup/${UUID.toUpperCase()}`]);
});

test('parseEventInput reporta los inválidos sin descartar los válidos', () => {
  const r = parseEventInput(`${UUID} hola https://example.com/x`);
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.invalid, [
    { input: 'hola', reason: REASONS.notLink },
    { input: 'https://example.com/x', reason: REASONS.otherSite },
  ]);
});

test('parseEventInput avisa cuando se supera el máximo de eventos', () => {
  const ids = Array.from({ length: MAX_EVENTS + 1 }, (_, i) =>
    `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.equal(parseEventInput(ids.join('\n')).withinLimit, false);
  assert.equal(parseEventInput(ids.slice(0, MAX_EVENTS).join('\n')).withinLimit, true);
});

test('parseEventInput con entrada vacía', () => {
  assert.deepEqual(parseEventInput(''), { events: [], invalid: [], duplicates: [], withinLimit: true });
  assert.deepEqual(parseEventInput(undefined).events, []);
});
