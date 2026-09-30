// Prüft die Versions-ID der Website (version.json). Fehlt die gemerkte ID oder
// weicht sie ab, werden Browser-Caches (Cache Storage, Service Worker) geleert
// und die Seite einmal neu geladen, damit immer der neueste Stand erscheint.
(function () {
  "use strict";
  var KEY = "gs-build-id";
  var RELOAD_KEY = "gs-reloaded-for";
  var script = document.currentScript;
  if (!script || !window.fetch) return;
  var url = new URL("../version.json", script.src).href + "?t=" + Date.now();

  function clearCaches() {
    var jobs = [];
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (r) { return r.unregister(); }));
      }));
    }
    return Promise.all(jobs).catch(function () {});
  }

  fetch(url, { cache: "no-store" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (v) {
      if (!v || !v.id) return;
      var stored = null;
      try { stored = localStorage.getItem(KEY); } catch (e) {}
      if (stored === v.id) return;
      return clearCaches().then(function () {
        try { localStorage.setItem(KEY, v.id); } catch (e) {}
        var alreadyReloaded = false;
        try { alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === v.id; sessionStorage.setItem(RELOAD_KEY, v.id); } catch (e) {}
        // Erstbesuch (keine ID gemerkt): Seite ist ohnehin frisch. Sonst einmal neu laden.
        if (stored && !alreadyReloaded) location.reload();
      });
    })
    .catch(function () {});
})();
