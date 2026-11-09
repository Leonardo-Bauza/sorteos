(function () {
  var URL_SCRIPT = 'https://script.google.com/macros/s/AKfycby3FPkcN5qH4x_kFjlw9gXGnku4XV6PZ6K9_LoP8urhJAmPU_sovvuwp_eOOcHvafUg/exec';
  var TOKEN = '44ss44d55f5g66h66hH';
  try {
    if (localStorage.getItem('no_track')) return;
    var tag = document.currentScript;
    var repo = (tag && tag.getAttribute('data-repo')) ||
      (location.hostname + '/' + (location.pathname.split('/')[1] || ''));
    var vid = localStorage.getItem('vid');
    if (!vid) {
      vid = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('vid', vid);
    }
    var q = new URLSearchParams({
      t: TOKEN,
      repo: repo,
      vid: vid,
      url: location.href,
      ref: document.referrer,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ua: navigator.userAgent
    });

    fetch(URL_SCRIPT + '?' + q.toString(), { mode: 'no-cors', keepalive: true });
  } catch (e) {}
})();
