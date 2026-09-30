/* Grundschule Flegessen – Admin: Start, Anmeldung, Menü, Routing, Speichern-Leiste */
(function (G) {
  "use strict";
  const { h, icon, api, toast, clear } = G;
  const $ = (id) => document.getElementById(id);
  let routeToken = 0;

  /* ---------- Anmeldung ---------- */
  function showLogin(message) {
    $("app").hidden = true;
    $("login").hidden = false;
    document.body.classList.remove("nav-open");
    const err = $("loginError");
    err.textContent = message || "";
    setTimeout(() => $("loginPw").focus(), 30);
    // frisches CSRF-Token holen
    api("session").then((s) => { G.session.csrf = s.csrf; }).catch((e) => { err.textContent = e.message; });
  }
  G.onLoggedOut = showLogin;

  async function doLogin(ev) {
    ev.preventDefault();
    const pw = $("loginPw");
    const err = $("loginError");
    const btn = $("loginBtn");
    err.textContent = "";
    if (!pw.value) { err.textContent = "Bitte Passwort eingeben."; pw.focus(); return; }
    btn.disabled = true;
    try {
      const r = await api("login", { method: "POST", json: { password: pw.value } });
      G.session.csrf = r.csrf; G.session.passwordInitial = !!r.password_is_initial;
      pw.value = "";
      await enterApp();
    } catch (e) {
      err.textContent = e.message;
      pw.select();
    }
    btn.disabled = false;
  }

  async function enterApp() {
    G.session.authenticated = true;
    $("login").hidden = true;
    $("app").hidden = false;
    try {
      await G.editor.loadContent();
    } catch (e) {
      $("main").appendChild(h("div", { class: "notice error", role: "alert" }, "Inhalte konnten nicht geladen werden: " + e.message));
      return;
    }
    buildMenu();
    route();
  }

  async function logout() {
    if (G.dirtyCount && !(await G.confirm({ title: "Abmelden?", text: "Es gibt ungespeicherte Änderungen, die verloren gehen.", confirmLabel: "Trotzdem abmelden", danger: true }))) return;
    G.dirtyCount = 0;
    try { await api("logout", { method: "POST" }); } catch (e) { /* egal */ }
    location.hash = "";
    location.reload();
  }

  /* ---------- Menü ---------- */
  const MAIN = [
    { id: "home", hash: "#/", label: "Übersicht", icon: "home" },
    { id: "seiten", label: "Seiten & Texte", icon: "file", group: true },
    { id: "medien", label: "Bilder & Medien", icon: "image", group: true },
    { id: "backup", hash: "#/backup", label: "Backup & Wiederherstellung", icon: "archive" },
    { id: "verlauf", hash: "#/verlauf", label: "Verlauf", icon: "clock" },
    { id: "einstellungen", hash: "#/einstellungen", label: "Einstellungen", icon: "settings" },
  ];
  function parseRoute() {
    const hsh = (location.hash || "#/").replace(/^#\/?/, "");
    const parts = hsh.split("/").filter(Boolean).map(decodeURIComponent);
    return { name: parts[0] || "home", arg: parts[1] || null };
  }
  const open = { seiten: true, medien: true };

  function buildMenu() {
    const nav = $("menu");
    clear(nav);
    const r = parseRoute();
    const Ed = G.editor;
    const ul = h("ul", { class: "menu-list" });
    MAIN.forEach((m) => {
      const li = h("li");
      const active = m.id === r.name || (m.id === "medien" && r.name === "galerie");
      if (!m.group) {
        li.appendChild(h("a", { class: "menu-item" + (active ? " active" : ""), href: m.hash, "aria-current": active ? "page" : null }, icon(m.icon), h("span", { text: m.label })));
      } else {
        const isOpen = open[m.id] || active;
        const btn = h("button", { type: "button", class: "menu-item group-toggle" + (active ? " active" : ""), "aria-expanded": String(isOpen), "aria-controls": "sub-" + m.id,
          onclick: () => { open[m.id] = !(open[m.id] || active) ; buildMenu(); } },
          icon(m.icon), h("span", { text: m.label }), h("span", { class: "chev", "aria-hidden": "true" }, icon("chevron")));
        li.appendChild(btn);
        const sub = h("ul", { class: "submenu", id: "sub-" + m.id, hidden: !isOpen });
        if (m.id === "seiten") {
          Ed.pageKeys().forEach((k) => {
            const on = r.name === "seiten" && r.arg === k;
            const n = Ed.pageChangedCount(k);
            sub.appendChild(h("li", null, h("a", { class: "menu-sub" + (on ? " active" : ""), href: "#/seiten/" + encodeURIComponent(k), "aria-current": on ? "page" : null },
              h("span", { text: Ed.pageLabel(k) }), n ? h("span", { class: "count", title: n + " geänderte Felder", text: String(n) }) : null)));
          });
        } else {
          [["medien", "#/medien", "Mediathek"], ["galerie", "#/galerie", "Galerie"]].forEach(([id, hash, label]) => {
            const on = r.name === id;
            sub.appendChild(h("li", null, h("a", { class: "menu-sub" + (on ? " active" : ""), href: hash, "aria-current": on ? "page" : null }, h("span", { text: label }))));
          });
        }
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
    nav.appendChild(ul);
    nav.appendChild(h("div", { class: "menu-foot" },
      h("a", { class: "menu-item", href: "../index.html", target: "_blank", rel: "noopener" }, icon("external"), h("span", { text: "Website ansehen" })),
      h("button", { type: "button", class: "menu-item", onclick: logout }, icon("logout"), h("span", { text: "Abmelden" }))));
  }
  G.refreshMenu = buildMenu;

  function closeDrawer() {
    document.body.classList.remove("nav-open");
    $("menuToggle").setAttribute("aria-expanded", "false");
  }
  function toggleDrawer() {
    const on = !document.body.classList.contains("nav-open");
    document.body.classList.toggle("nav-open", on);
    $("menuToggle").setAttribute("aria-expanded", String(on));
    if (on) { const f = $("menu").querySelector("a,button"); if (f) f.focus(); }
  }

  /* ---------- Routing ---------- */
  const TITLES = { home: "Übersicht", medien: "Bilder & Medien", galerie: "Galerie", backup: "Backup & Wiederherstellung", verlauf: "Verlauf", einstellungen: "Einstellungen" };

  async function route(keepFocus) {
    if (!G.session.authenticated) return;
    const my = ++routeToken;
    const r = parseRoute();
    const Ed = G.editor;
    const main = $("main");
    const view = h("div", { class: "view" });
    clear(main); main.appendChild(view);
    closeDrawer();
    buildMenu();
    let title = TITLES[r.name] || "Übersicht";
    try {
      if (r.name === "seiten") {
        const key = r.arg && Ed.pageKeys().includes(r.arg) ? r.arg : Ed.pageKeys()[1];
        title = Ed.pageLabel(key);
        Ed.renderPage(view, key);
      } else if (r.name === "medien") await G.renderMedia(view);
      else if (r.name === "galerie") await G.renderGallery(view);
      else if (r.name === "backup") await G.renderBackup(view);
      else if (r.name === "verlauf") await G.renderHistory(view);
      else if (r.name === "einstellungen") await G.renderSettings(view);
      else await G.renderDashboard(view);
    } catch (e) {
      console.error(e);
      view.appendChild(h("div", { class: "notice error", role: "alert" }, "Diese Ansicht konnte nicht geladen werden: " + e.message));
    }
    if (my !== routeToken) return;
    document.title = title + " – Admin Grundschule Flegessen";
    updateBar();
    if (!keepFocus) {
      const h1 = view.querySelector("h1");
      if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
    }
  }
  G.route = route;
  G.rerender = () => { const y = window.scrollY; return route(true).then(() => window.scrollTo(0, y)); };

  /* ---------- Speichern-Leiste ---------- */
  function updateBar() {
    const n = G.content.dirty.size;
    const r = parseRoute();
    const editorView = r.name === "seiten" || r.name === "galerie";
    const bar = $("savebar");
    bar.hidden = !(n > 0 || editorView);
    $("saveBtn").disabled = n === 0;
    $("discardBtn").disabled = n === 0;
    const st = $("saveStatus");
    st.className = "save-status" + (n ? " dirty" : "");
    st.textContent = n ? n + " ungespeicherte Änderung" + (n === 1 ? "" : "en") : "Alles gespeichert";
    $("topDirty").hidden = n === 0;
    document.body.classList.toggle("has-savebar", !bar.hidden);
  }
  G.onDirtyChange(updateBar);

  async function doSave() {
    const btn = $("saveBtn");
    if (btn.disabled) return;
    btn.disabled = true; btn.lastChild.textContent = "Speichere …";
    const ok = await G.editor.save();
    btn.lastChild.textContent = "Speichern";
    if (ok) { buildMenu(); await G.rerender(); }
    updateBar();
  }

  /* ---------- Start ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    $("loginForm").addEventListener("submit", doLogin);
    $("pwToggle").addEventListener("click", () => {
      const pw = $("loginPw"); const show = pw.type === "password";
      pw.type = show ? "text" : "password";
      $("pwToggle").setAttribute("aria-pressed", String(show));
      $("pwToggle").textContent = show ? "Verbergen" : "Anzeigen";
    });
    $("menuToggle").addEventListener("click", toggleDrawer);
    $("scrim").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.body.classList.contains("nav-open") && !document.querySelector(".overlay")) { closeDrawer(); $("menuToggle").focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && G.session.authenticated) { e.preventDefault(); doSave(); }
    });
    $("saveBtn").addEventListener("click", doSave);
    $("discardBtn").addEventListener("click", async () => { if (await G.editor.discard()) { buildMenu(); await G.rerender(); updateBar(); toast("Änderungen verworfen."); } });
    window.addEventListener("hashchange", () => route());
    (async () => {
      try {
        const s = await api("session");
        G.session.csrf = s.csrf;
        if (s.authenticated) await enterApp(); else { $("login").hidden = false; $("loginPw").focus(); }
      } catch (e) {
        $("login").hidden = false;
        $("loginError").textContent = e.message + (e.status === 404 || e.status === 0 ? " Der Admin-Bereich benötigt PHP-Webspace." : "");
      }
    })();
  });
})(window.GSA);
