// Helpers mínimos para armar DOM sin innerHTML: todo texto entra como nodo
// de texto, así un nombre como "<img onerror=…>" se muestra literal.

const SAFE_URL = /^https:\/\//i;

/**
 * h('li', { class: 'x', onclick: fn, dataset: { key } }, 'texto', otroNodo)
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name === 'dataset') Object.assign(el.dataset, value);
    else if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2), value);
    else if (name === 'href' || name === 'src') {
      if (SAFE_URL.test(String(value))) el.setAttribute(name, value);
    } else if (/^(innerhtml|outerhtml|srcdoc)$/i.test(name) || /^on/i.test(name)) {
      throw new Error(`Atributo no permitido: ${name}`);
    } else el.setAttribute(name, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);

export function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

let announceTimer;
/** Anuncia un texto a lectores de pantalla. */
export function announce(text) {
  const el = document.getElementById('announcer');
  if (!el) return;
  el.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { el.textContent = text; }, 50);
}

let toastTimer;
export function toast(text, { error = false } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', error);
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
}

/** Diálogo de confirmación nativo. @returns {Promise<boolean>} */
export function confirmDialog({ title, text, ok = 'Confirmar' }) {
  const dlg = document.getElementById('dlg-confirm');
  document.getElementById('dlg-confirm-title').textContent = title;
  document.getElementById('dlg-confirm-text').textContent = text;
  document.getElementById('dlg-confirm-ok').textContent = ok;
  return showDialog(dlg).then((value) => value === 'ok');
}

/** Abre un <dialog> y resuelve con el value del botón que lo cerró. */
export function showDialog(dlg) {
  return new Promise((resolve) => {
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
    dlg.showModal();
  });
}

export const wait = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) return resolve();
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});
