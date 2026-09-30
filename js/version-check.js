// Prüft die Versions-ID der Website (api/?a=version, Fallback version.json).
// Die ID besteht aus "<Build-ID>.<Inhalts-Revision>". Fehlt die gemerkte ID oder weicht sie ab,
// werden Cache Storage und Service Worker geleert. Nur wenn das geladene HTML veraltet ist
// (Build-ID der Seite != Build-ID des Servers), wird einmal neu geladen.
(function () {
  "use strict";
  var KEY = "gs-build-id";
  var RELOAD_KEY = "gs-reloaded-for";
  var script = document.currentScript;
  if (!script || !window.fetch) return;
  var pageBuild = (script.src.match(/[?&]v=([^&]+)/) || [])[1];
  var base = script.src.split("?")[0];
  var urls = [
    new URL("../api/?a=version&t=" + Date.now(), base).href,
    new URL("../version.json?t=" + Date.now(), base).href
  ];

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

  function load(i) {
    if (i >= urls.length) return Promise.resolve(null);
    return fetch(urls[i], { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (v) { return v && v.id ? v : Promise.reject(); })
      .catch(function () { return load(i + 1); });
  }

  load(0).then(function (v) {
    if (!v) return;
    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    var serverBuild = String(v.id).split(".")[0];
    var stale = pageBuild && pageBuild !== serverBuild;
    var changed = stored !== v.id;
    if (!changed && !stale) return;
    return clearCaches().then(function () {
      try { localStorage.setItem(KEY, v.id); } catch (e) {}
      var done = false;
      try { done = sessionStorage.getItem(RELOAD_KEY) === v.id; sessionStorage.setItem(RELOAD_KEY, v.id); } catch (e) {}
      if (stale && !done) location.reload();
    });
  }).catch(function () {});
})();
