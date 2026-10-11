// Efectos visuales del revelado. Son solo "teatro": el ganador ya fue
// elegido con crypto ANTES de que arranque la animación, que termina
// siempre en ese nombre. Los nombres que pasan por el rodillo son al azar
// con Math.random porque no deciden nada.

import { prefersReducedMotion, wait } from './dom.js';

/**
 * Hace girar nombres en `el` y frena en `finalName`.
 * @param {HTMLElement} el
 * @param {string[]} names  nombres para mostrar mientras gira
 * @param {string} finalName
 * @param {{duration?: number, signal?: AbortSignal}} opts  signal permite "saltar animación"
 */
export async function rollNames(el, names, finalName, { duration = 2600, signal } = {}) {
  const box = el.parentElement;
  box.classList.remove('is-final');
  if (prefersReducedMotion() || names.length < 2 || signal?.aborted) {
    el.textContent = finalName;
    box.classList.add('is-final');
    return;
  }
  box.classList.add('is-rolling');
  const start = performance.now();
  let last = '';
  while (!signal?.aborted) {
    const elapsed = performance.now() - start;
    if (elapsed >= duration) break;
    let next;
    do next = names[Math.floor(Math.random() * names.length)]; while (next === last && names.length > 1);
    last = next;
    el.textContent = next;
    // Arranca rápido (≈45 ms) y va frenando (≈320 ms) para dar suspenso.
    const t = elapsed / duration;
    await wait(45 + 275 * t * t, signal);
  }
  box.classList.remove('is-rolling');
  el.textContent = finalName;
  box.classList.add('is-final');
}

const COLORS = ['#ff4f9a', '#ff9f1c', '#ffd23f', '#3ee0f5', '#4ade80', '#8b5cf6', '#ffffff'];
let running = null;

/** Lluvia de confeti en el <canvas id="confetti">. No hace nada con movimiento reducido. */
export function confetti({ amount = 160, duration = 2800 } = {}) {
  if (prefersReducedMotion()) return;
  const canvas = document.getElementById('confetti');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pieces = Array.from({ length: amount }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: hgt * 0.35 + (Math.random() - 0.5) * 40,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 4,
    size: 6 + Math.random() * 7,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.35,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    star: Math.random() < 0.25,
  }));

  if (running) cancelAnimationFrame(running);
  const start = performance.now();

  const frame = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, hgt);
    const fade = Math.max(0, 1 - Math.max(0, elapsed - duration * 0.6) / (duration * 0.4));
    for (const p of pieces) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.star) drawStar(ctx, p.size * 0.7);
      else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (elapsed < duration) running = requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, w, hgt); running = null; }
  };
  running = requestAnimationFrame(frame);
}

function drawStar(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  ctx.closePath();
  ctx.fill();
}
