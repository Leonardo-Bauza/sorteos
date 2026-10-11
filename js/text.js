// Limpieza de textos que vienen de afuera (API o lista pegada a mano).
// No reemplaza insertar con textContent en el DOM: evita nombres que
// rompan el layout o confundan al leerlos (caracteres de control,
// marcas de dirección bidi, espacios raros, textos enormes).

const CONTROL_RE = /[\p{Cc}‪-‮⁦-⁩]/gu;

export function cleanText(value, maxLength = 64) {
  if (typeof value !== 'string') return '';
  const text = value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text); // corta por code point, no parte emojis a la mitad
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('')}…` : text;
}

// Para comparar nombres sin importar mayúsculas, tildes ni un "@" adelante.
export function normalizeForMatch(value) {
  return cleanText(String(value ?? ''), 200)
    .replace(/^@+/, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}
