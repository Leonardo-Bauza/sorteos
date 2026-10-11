// Persistencia local (solo en este navegador) de la lista de bloqueados y
// de preferencias de uso. Si localStorage no está disponible (modo privado,
// bloqueado por el navegador), la app sigue funcionando sin guardar.
// Los filtros del sorteo NO se guardan: siempre arrancan en sus valores por defecto.

import { cleanText, normalizeForMatch } from './text.js';

const PREFIX = 'sorteos-caseros:v1:';
const BLOCKED_KEY = `${PREFIX}blocked`;
const PREFS_KEY = `${PREFIX}prefs`;

export const MAX_BLOCKED = 500;
export const DEFAULT_PREFS = Object.freeze({ winners: 1, alternates: 0, mode: 'oneByOne' });
const MODES = ['oneByOne', 'all'];
const MAX_COUNT = 1000;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // algunos navegadores tiran error con solo acceder si está bloqueado
  }
}

function readJSON(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJSON(storage, key, value) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // sin espacio o sin permiso
  }
}

/** Limpia una lista de bloqueados: sin vacíos, sin repetidos, con tope. */
export function normalizeBlockedList(items) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const value = cleanText(typeof item === 'string' ? item : '', 100);
    const norm = normalizeForMatch(value);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(value);
    if (out.length >= MAX_BLOCKED) break;
  }
  return out;
}

/** Para el cuadro de texto editable: un bloqueado por línea. */
export function parseBlockedText(text) {
  return normalizeBlockedList(String(text ?? '').split(/\r?\n/));
}

export function loadBlocked(storage = defaultStorage()) {
  return normalizeBlockedList(readJSON(storage, BLOCKED_KEY));
}

/** @returns {{saved: boolean, list: string[]}} */
export function saveBlocked(items, storage = defaultStorage()) {
  const list = normalizeBlockedList(items);
  return { saved: writeJSON(storage, BLOCKED_KEY, list), list };
}

function toCount(value, fallback, min) {
  return Number.isInteger(value) && value >= min && value <= MAX_COUNT ? value : fallback;
}

export function normalizePrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    winners: toCount(p.winners, DEFAULT_PREFS.winners, 1),
    alternates: toCount(p.alternates, DEFAULT_PREFS.alternates, 0),
    mode: MODES.includes(p.mode) ? p.mode : DEFAULT_PREFS.mode,
  };
}

export function loadPrefs(storage = defaultStorage()) {
  return normalizePrefs(readJSON(storage, PREFS_KEY));
}

export function savePrefs(prefs, storage = defaultStorage()) {
  const value = normalizePrefs(prefs);
  return { saved: writeJSON(storage, PREFS_KEY, value), prefs: value };
}
