// App instalable (PWA): registra el service worker y muestra cómo instalarla.

const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export function setupPwa() {
  // Los service workers solo funcionan con https (o localhost para probar).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocalhost)) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }

  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return; // ya está instalada

  const box = document.getElementById('install-box');
  const btn = document.getElementById('install-btn');
  const iosHint = document.getElementById('ios-hint');
  let deferred = null;

  // Android / Chrome / Edge: el navegador avisa que se puede instalar.
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferred = ev;
    box.hidden = false;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { box.hidden = true; });

  // iPhone/iPad: no hay botón; se instala desde el menú Compartir de Safari.
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    box.hidden = false;
    iosHint.hidden = false;
  }
}
