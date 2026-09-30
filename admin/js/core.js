/* Grundschule Flegessen – Admin: Kernfunktionen (API, DOM-Helfer, Dialoge, Icons) */
(function (G) {
  "use strict";

  const API = "../api/";

  /* ---------- kleine DOM-Hilfe ---------- */
  function h(tag, props) {
    const el = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden" || k === "selected") el[k] = v;
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach((k) => append(el, k));
    else if (kid instanceof Node) el.appendChild(kid);
    else el.appendChild(document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  /* ---------- Icons (Feather-artige Linien-Icons, inline) ---------- */
  const ICONS = {
    home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
    file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
    image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8.5 7.5a1 1 0 1 0 0.01 0 M21 15l-5-5L5 21",
    archive: "M21 8v13H3V8 M1 3h22v5H1z M10 12h4",
    clock: "M12 2a10 10 0 1 0 0.01 0 M12 6v6l4 2",
    settings: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
    logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
    menu: "M3 12h18 M3 6h18 M3 18h18",
    x: "M18 6L6 18 M6 6l12 12",
    plus: "M12 5v14 M5 12h14",
    trash: "M3 6h18 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
    up: "M12 19V5 M5 12l7-7 7 7",
    down: "M12 5v14 M19 12l-7 7-7-7",
    left: "M19 12H5 M12 19l-7-7 7-7",
    right: "M5 12h14 M12 5l7 7-7 7",
    upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
    check: "M20 6L9 17l-5-5",
    warn: "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
    external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3",
    undo: "M1 4v6h6 M3.5 15a9 9 0 1 0 2.1-9.4L1 10",
    copy: "M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
    chevron: "M9 18l6-6-6-6",
    save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
    eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0.01 0",
    code: "M16 18l6-6-6-6 M8 6l-6 6 6 6",
    list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  };
  function icon(name, cls) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "ico" + (cls ? " " + cls : ""));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    (ICONS[name] || "").split(" M").forEach((d, i) => {
      if (!d) return;
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", (i ? "M" : "") + d);
      svg.appendChild(p);
    });
    return svg;
  }

  /* ---------- Formatierung ---------- */
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " Uhr";
  }
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0).replace(".", ",") + " KB";
    return (b / 1048576).toFixed(1).replace(".", ",") + " MB";
  }
  function plainText(html) {
    const doc = new DOMParser().parseFromString("<body>" + String(html || "") + "</body>", "text/html"); // inert: nichts wird ausgeführt
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  function trunc(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg, kind) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show" + (kind === "error" ? " error" : kind === "warn" ? " warn" : "");
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), kind === "error" ? 7000 : 3800);
  }

  /* ---------- API ---------- */
  class ApiError extends Error {
    constructor(status, message, data) { super(message); this.status = status; this.data = data || {}; }
  }
  G.session = { csrf: "", authenticated: false, mustChange: false };

  async function api(action, opts) {
    opts = opts || {};
    const method = opts.method || "GET";
    let url = API + "?a=" + encodeURIComponent(action);
    if (opts.query) for (const k of Object.keys(opts.query)) url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(opts.query[k]);
    const headers = { Accept: "application/json" };
    let body;
    if (method !== "GET") headers["X-CSRF-Token"] = G.session.csrf;
    if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
    else if (opts.form) body = opts.form;
    else if (method === "POST") { headers["Content-Type"] = "application/json"; body = "{}"; }
    let res;
    try {
      res = await fetch(url, { method, headers, body, credentials: "same-origin", cache: "no-store" });
    } catch (e) {
      throw new ApiError(0, "Keine Verbindung zum Server. Bitte Internetverbindung prüfen.");
    }
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!res.ok || !data || data.ok === false) {
      const msg = (data && data.error) || (res.status === 404 ? "Die API wurde nicht gefunden (läuft PHP auf diesem Server?)." : "Serverfehler (" + res.status + ").");
      // Sitzung abgelaufen (oder durch Passwortwechsel anderswo ungültig): Entwurf im Speicher behalten, Anmeldung als
      // Overlay zeigen und die Anfrage nach erfolgreicher Anmeldung wiederholen – nichts wird neu geladen oder verworfen.
      if (res.status === 401 && G.session.authenticated && action !== "login" && action !== "session" && !opts._retried && G.reauth) {
        const again = await G.reauth();
        if (again) return api(action, Object.assign({}, opts, { _retried: true }));
        throw new ApiError(401, "Nicht angemeldet. Ihre Änderungen sind im Editor noch vorhanden – bitte erneut anmelden und speichern.", data || {});
      }
      if (res.status === 403 && data && data.error === "password_change_required") {
        G.session.mustChange = true;
        if (G.onMustChange) G.onMustChange();
        throw new ApiError(403, "Bitte legen Sie zuerst ein neues Passwort fest.", data);
      }
      throw new ApiError(res.status, msg, data || {});
    }
    return data;
  }

  /* ---------- Dialoge ---------- */
  let modalCount = 0;
  function modal(opts) {
    // opts: {title, body(Node), actions:[{label, kind, value, primary}], wide, onClose}
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const titleId = "dlg-title-" + (++modalCount);
      const box = h("div", { class: "dialog" + (opts.wide ? " wide" : ""), role: opts.alert ? "alertdialog" : "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" });
      const overlay = h("div", { class: "overlay" }, box);
      let closed = false;
      function close(val) {
        if (closed) return;
        closed = true;
        overlay.remove();
        document.body.classList.remove("modal-open");
        document.removeEventListener("keydown", onKey, true);
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
        resolve(val);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.stopPropagation(); close(opts.escValue === undefined ? null : opts.escValue); }
        else if (e.key === "Tab") {
          const f = box.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      const head = h("div", { class: "dialog-head" }, h("h2", { id: titleId, text: opts.title || "" }),
        opts.noClose ? null : h("button", { type: "button", class: "icon-btn", "aria-label": "Schließen", onclick: () => close(opts.escValue === undefined ? null : opts.escValue) }, icon("x")));
      box.appendChild(head);
      const body = h("div", { class: "dialog-body" }, opts.body);
      box.appendChild(body);
      if (opts.actions && opts.actions.length) {
        const foot = h("div", { class: "dialog-foot" });
        opts.actions.forEach((a) => {
          const b = h("button", { type: "button", class: "btn " + (a.kind || "btn-outline"), onclick: () => close(a.value) }, a.label);
          if (a.autofocus) b.dataset.autofocus = "1";
          foot.appendChild(b);
        });
        box.appendChild(foot);
      }
      document.body.appendChild(overlay);
      document.body.classList.add("modal-open");
      document.addEventListener("keydown", onKey, true);
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && !opts.noClose) close(opts.escValue === undefined ? null : opts.escValue); });
      const af = box.querySelector("[data-autofocus]") || box.querySelector("input,textarea,select") || box;
      setTimeout(() => af.focus(), 20);
      if (opts.onOpen) opts.onOpen(box, close);
    });
  }

  /** Bestätigungsdialog. opts: {title, text, confirmLabel, danger, typeWord} -> Promise<boolean> */
  function confirmDialog(opts) {
    const body = h("div", null,
      typeof opts.text === "string" ? h("p", { text: opts.text }) : opts.text);
    let input = null;
    let confirmBtn;
    if (opts.typeWord) {
      input = h("input", { type: "text", class: "input", "aria-label": "Bestätigungswort eingeben", autocomplete: "off", placeholder: opts.typeWord });
      body.appendChild(h("p", null, "Zur Bestätigung bitte ", h("strong", { text: opts.typeWord }), " eingeben:"));
      body.appendChild(input);
    }
    return modal({
      title: opts.title || "Bitte bestätigen",
      body,
      alert: true,
      escValue: false,
      actions: [
        { label: opts.cancelLabel || "Abbrechen", kind: "btn-outline", value: false, autofocus: !opts.danger },
        { label: opts.confirmLabel || "OK", kind: opts.danger ? "btn-danger" : "btn-primary", value: true },
      ],
      onOpen(box, close) {
        confirmBtn = box.querySelector(".btn-danger, .btn-primary");
        if (input) {
          confirmBtn.disabled = true;
          input.addEventListener("input", () => { confirmBtn.disabled = input.value.trim().toUpperCase() !== opts.typeWord.toUpperCase(); });
          input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !confirmBtn.disabled) close(true); });
        }
      },
    }).then((v) => v === true);
  }

  function infoDialog(title, bodyNode, wide) {
    return modal({ title, body: bodyNode, wide: !!wide, actions: [{ label: "Schließen", kind: "btn-primary", value: true, autofocus: true }] });
  }

  /* ---------- Ungespeicherte Änderungen ---------- */
  G.dirtyCount = 0;
  window.addEventListener("beforeunload", (e) => {
    if (G.dirtyCount > 0) { e.preventDefault(); e.returnValue = ""; return ""; }
  });

  /* ---------- Clipboard ---------- */
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast("Kopiert: " + t); return; } catch (e) { /* Fallback */ }
    const ta = h("textarea", { style: { position: "fixed", opacity: "0" } });
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Kopiert: " + t); } catch (e) { toast("Kopieren nicht möglich.", "error"); }
    ta.remove();
  }

  Object.assign(G, { h, clear, icon, api, ApiError, modal, confirm: confirmDialog, infoDialog, toast, fmtDate, fmtBytes, plainText, trunc, clone, copyText, API });
})((window.GSA = window.GSA || {}));
