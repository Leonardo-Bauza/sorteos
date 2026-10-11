import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, normalizeForMatch } from '../js/text.js';

test('cleanText recorta, colapsa espacios y saca caracteres de control', () => {
  assert.equal(cleanText('  Ana \t\n María  '), 'Ana María');
  assert.equal(cleanText('x‮y⁦z'), 'x y z');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(42), '');
});

test('cleanText conserva emojis compuestos y no los corta a la mitad', () => {
  assert.equal(cleanText('CiroSinPersas 🇦🇷'), 'CiroSinPersas 🇦🇷');
  assert.equal(cleanText('👩‍👩‍👧 familia'), '👩‍👩‍👧 familia');
  const long = '😀'.repeat(70);
  const out = cleanText(long, 10);
  assert.equal(Array.from(out).length, 10);
  assert.ok(out.endsWith('…'));
});

test('normalizeForMatch ignora mayúsculas, tildes y @', () => {
  assert.equal(normalizeForMatch('@Él_Pepé'), 'el_pepe');
  assert.equal(normalizeForMatch(undefined), '');
});
