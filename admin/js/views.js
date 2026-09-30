/* Grundschule Flegessen – Admin: Übersicht, Backup, Verlauf, Einstellungen */
(function (G) {
  "use strict";
  const { h, icon, api, toast, clear, fmtDate, fmtBytes } = G;

  function pageHead(title, lead, actions) {
    return h("div", { class: "page-head" }, h("div", null, h("h1", { text: title }), lead ? h("p", { class: "lead", text: lead }) : null), actions ? h("div", { class: "btn-row" }, actions) : null);
  }
  function loading(t) { return h("p", { class: "loading", role: "status", text: t || "Lade …" }); }
  function errBox(msg) { return h("div", { class: "notice error", role: "alert" }, icon("warn"), " ", msg); }

  /** Ungespeicherte Änderungen vor serverseitigen Aktionen bestätigen; danach Inhalte neu laden. */
  async function guardDirty(what) {
    if (!G.dirtyCount) return true;
    return G.confirm({ title: "Ungespeicherte Änderungen", text: "Sie haben Änderungen, die noch nicht gespeichert sind. Sie gehen bei „" + what + "“ verloren.", confirmLabel: "Trotzdem fortfahren", danger: true });
  }
  async function reloadContent() {
    await G.editor.loadContent();
    if (G.refreshMenu) G.refreshMenu();
  }

  function reportNode(r) {
    const wrap = h("div", { class: "report" });
    const sk = r.skipped || [];
    wrap.appendChild(h("p", null, h("strong", { text: r.imported + (r.imported === 1 ? " Eintrag" : " Einträge") }), " wurden übernommen. ",
      sk.length ? h("strong", { text: sk.length + " übersprungen." }) : "Nichts wurde übersprungen."));
    if (r.skipped && r.skipped.length) {
      wrap.appendChild(h("p", { class: "field-hint", text: "Übersprungen wird, was nicht mehr zur aktuellen Website-Struktur passt oder ungültig ist:" }));
      const ul = h("ul", { class: "err-list" });
      r.skipped.forEach((s) => ul.appendChild(h("li", null, h("code", { text: s.path }), h("div", { text: s.reason }))));
      wrap.appendChild(ul);
    }
    if (r.media) wrap.appendChild(h("p", { class: "field-hint", text: "Bilder: " + r.media.restored + " wiederhergestellt, " + r.media.existing + " waren schon vorhanden" + (r.media.rejected ? ", " + r.media.rejected + " abgelehnt" : "") + "." }));
    if (r.auto_backup) wrap.appendChild(h("p", { class: "field-hint", text: "Vorher wurde automatisch gesichert: " + r.auto_backup }));
    return wrap;
  }

  /* ================= Übersicht ================= */
  async function renderDashboard(container) {
    container.appendChild(pageHead("Willkommen im Admin-Bereich", "Hier pflegen Sie alle Texte und Bilder der Website der Grundschule Flegessen. Änderungen sind nach dem Speichern sofort online."));
    const host = h("div"); container.appendChild(host); host.appendChild(loading());
    let health, revs, backups;
    try {
      [health, revs, backups] = await Promise.all([api("health"), api("revisions"), api("backup_list")]);
    } catch (e) { clear(host); host.appendChild(errBox(e.message)); return; }
    clear(host);
    const S = G.content;
    const problems = health.checks.filter((c) => c.level !== "ok");
    const errs = problems.filter((c) => c.level === "error");

    if (G.session.passwordInitial || health.checks.some((c) => c.id === "password" && c.level !== "ok")) {
      host.appendChild(h("div", { class: "notice warn" }, icon("warn"), h("div", null, h("strong", { text: "Bitte ändern Sie das Start-Passwort." }), " Es steht in der Dokumentation und ist deshalb nicht sicher. ", h("a", { href: "#/einstellungen", text: "Jetzt Passwort ändern" }))));
    }
    if (S.orphans.length) {
      host.appendChild(h("div", { class: "notice info" }, icon("warn"), h("div", null, h("strong", { text: S.orphans.length + " gespeicherte Änderung" + (S.orphans.length === 1 ? "" : "en") + " passen nicht mehr zur aktuellen Website." }), " Sie werden nicht angewendet. ", h("a", { href: "#/einstellungen", text: "Ansehen" }))));
    }
    const changed = Object.keys(S.overridden || {}).length;
    const stats = h("div", { class: "stat-grid" },
      statCard("Geänderte Felder", String(changed), changed ? "weichen vom Standard ab" : "alles im Auslieferungszustand", "#/seiten/home"),
      statCard("Backups", String(backups.backups.length), backups.backups[0] ? "letztes: " + fmtDate(backups.backups[0].mtime) : "noch keine", "#/backup"),
      statCard("Systemprüfung", errs.length ? "Fehler" : problems.length ? "Hinweise" : "In Ordnung", errs.length ? errs.length + " Problem(e)" : problems.length ? problems.length + " Hinweis(e)" : "alle Prüfungen bestanden", "#/einstellungen", errs.length ? "bad" : problems.length ? "warn" : "good"));
    host.appendChild(stats);

    const quick = h("section", { class: "card" }, h("h2", { text: "Schnellzugriff" }),
      h("div", { class: "quick-grid" },
        quickBtn("file", "Texte bearbeiten", "Seiten & Texte", () => { location.hash = "#/seiten/home"; }),
        quickBtn("image", "Bilder verwalten", "Mediathek & Galerie", () => { location.hash = "#/medien"; }),
        quickBtn("archive", "Jetzt Backup erstellen", "inkl. Bilder", async (btn) => {
          btn.disabled = true;
          try { const r = await api("backup_create", { method: "POST", json: { note: "Manuelles Backup (Übersicht)", includeMedia: true } }); toast("Backup erstellt: " + r.backup.file + (r.backup.warning ? " – " + r.backup.warning : "")); G.route(); }
          catch (e) { toast("Backup fehlgeschlagen: " + e.message, "error"); btn.disabled = false; }
        }),
        h("a", { class: "quick", href: "../index.html", target: "_blank", rel: "noopener" }, icon("external"), h("span", null, h("strong", { text: "Website ansehen" }), h("small", { text: "öffnet in neuem Tab" })))));
    host.appendChild(quick);

    const last = h("section", { class: "card" }, h("h2", { text: "Letzte Änderungen" }));
    if (!revs.revisions.length) last.appendChild(h("p", { class: "empty-note", text: "Noch keine Änderungen gespeichert." }));
    else {
      const ul = h("ul", { class: "timeline" });
      revs.revisions.slice(0, 6).forEach((r) => ul.appendChild(h("li", null, h("time", { text: fmtDate(r.ts) }), h("span", { text: r.note || "Änderung" }))));
      last.appendChild(ul);
      last.appendChild(h("a", { href: "#/verlauf", text: "Gesamten Verlauf ansehen" }));
    }
    host.appendChild(last);

    const sys = h("section", { class: "card" }, h("h2", { text: "Systemprüfung" }));
    if (!problems.length) sys.appendChild(h("p", { class: "ok-line" }, icon("check"), " Alle Prüfungen bestanden."));
    else problems.forEach((c) => sys.appendChild(checkRow(c)));
    sys.appendChild(h("a", { href: "#/einstellungen", text: "Alle Prüfungen anzeigen" }));
    host.appendChild(sys);
  }
  function statCard(label, value, sub, href, tone) {
    return h("a", { class: "stat " + (tone || ""), href }, h("span", { class: "stat-label", text: label }), h("span", { class: "stat-value", text: value }), h("span", { class: "stat-sub", text: sub }));
  }
  function quickBtn(ic, title, sub, fn) {
    const b = h("button", { type: "button", class: "quick" }, icon(ic), h("span", null, h("strong", { text: title }), h("small", { text: sub })));
    b.addEventListener("click", () => fn(b));
    return b;
  }
  function checkRow(c) {
    return h("div", { class: "check-row " + c.level },
      icon(c.level === "ok" ? "check" : "warn"),
      h("div", null, h("strong", { text: c.label }), h("span", { class: "check-detail", text: " – " + c.detail }), c.hint && c.level !== "ok" ? h("div", { class: "field-hint", text: c.hint }) : null));
  }

  /* ================= Backup & Wiederherstellung ================= */
  async function renderBackup(container) {
    container.appendChild(pageHead("Backup & Wiederherstellung", "Sichern Sie Ihre Änderungen und spielen Sie bei Bedarf einen früheren Stand wieder ein."));
    const host = h("div"); container.appendChild(host);

    async function draw() {
      clear(host); host.appendChild(loading("Lade Backups …"));
      let r;
      try { r = await api("backup_list"); } catch (e) { clear(host); host.appendChild(errBox(e.message)); return; }
      clear(host);

      // --- neues Backup
      const note = h("input", { class: "input", type: "text", maxlength: "200", placeholder: "Notiz (optional), z. B. „vor Schuljahresbeginn“", "aria-label": "Notiz zum Backup" });
      const media = h("input", { type: "checkbox", id: "bkMedia", checked: r.zip });
      if (!r.zip) media.disabled = true;
      const go = h("button", { type: "button", class: "btn btn-primary", onclick: async () => {
        go.disabled = true; go.lastChild.textContent = "Erstelle …";
        try {
          const res = await api("backup_create", { method: "POST", json: { note: note.value, includeMedia: media.checked } });
          toast("Backup erstellt (" + fmtBytes(res.backup.bytes) + ")." + (res.backup.warning ? " " + res.backup.warning : ""));
          draw();
        } catch (e) { toast("Backup fehlgeschlagen: " + e.message, "error"); go.disabled = false; go.lastChild.textContent = "Backup erstellen"; }
      } }, icon("archive"), "Backup erstellen");
      host.appendChild(h("section", { class: "card" }, h("h2", { text: "Neues Backup erstellen" }),
        h("p", { class: "field-hint", text: "Gesichert werden alle Ihre Text- und Bildänderungen. Das Passwort ist nie Teil eines Backups." + (r.zip ? "" : " (Ohne die PHP-Erweiterung „zip“ ist nur ein Backup ohne Bilder möglich.)") }),
        h("label", { class: "mini-label" }, "Notiz", note),
        h("label", { class: "check", for: "bkMedia" }, media, " Hochgeladene Bilder mitsichern (größere Datei)"),
        h("div", { class: "btn-row" }, go)));

      // --- Liste
      const list = h("section", { class: "card" }, h("h2", { text: "Vorhandene Backups (" + r.backups.length + ")" }));
      if (!r.backups.length) list.appendChild(h("p", { class: "empty-note", text: "Noch keine Backups vorhanden." }));
      const rows = h("div", { class: "backup-list" });
      r.backups.forEach((b) => {
        rows.appendChild(h("div", { class: "backup-row" },
          h("div", { class: "b-main" },
            h("div", { class: "b-title" }, h("strong", { text: fmtDate(b.created_at || b.mtime) }),
              b.auto ? h("span", { class: "badge", text: "automatisch" }) : null,
              b.include_media ? h("span", { class: "badge badge-info", text: "mit Bildern" }) : null),
            h("div", { class: "b-note", text: b.note || "(ohne Notiz)" }),
            h("div", { class: "field-hint", text: fmtBytes(b.bytes) + (b.override_count !== null ? " · " + b.override_count + (b.override_count === 1 ? " geändertes Feld" : " geänderte Felder") : "") + (b.media_files ? " · " + b.media_files + " Bilddateien" : "") + " · " + b.file })),
          h("div", { class: "b-actions" },
            h("a", { class: "btn btn-outline btn-small", href: G.API + "?a=backup_download&file=" + encodeURIComponent(b.file), download: b.file }, icon("download"), "Herunterladen"),
            h("button", { type: "button", class: "btn btn-outline btn-small", onclick: () => restoreStored(b, draw) }, icon("undo"), "Wiederherstellen"),
            h("button", { type: "button", class: "btn btn-outline btn-small danger-text", "aria-label": "Backup vom " + fmtDate(b.mtime) + " löschen", onclick: async () => {
              if (!(await G.confirm({ title: "Backup löschen?", text: "Das Backup „" + b.file + "“ wird endgültig gelöscht.", confirmLabel: "Löschen", danger: true }))) return;
              try { await api("backup_delete", { method: "POST", json: { file: b.file } }); toast("Backup gelöscht."); draw(); } catch (e) { toast(e.message, "error"); }
            } }, icon("trash"), "Löschen"))));
      });
      list.appendChild(rows);
      list.appendChild(h("p", { class: "field-hint", text: "Automatische Sicherungen entstehen einmal täglich beim Speichern sowie vor jeder Wiederherstellung; die letzten " + 14 + " werden aufbewahrt." }));
      host.appendChild(list);

      // --- Datei einspielen
      const fi = h("input", { type: "file", accept: ".zip,.json,application/zip,application/json", class: "input", "aria-label": "Backup-Datei auswählen" });
      const up = h("button", { type: "button", class: "btn btn-outline", onclick: async () => {
        const f = fi.files && fi.files[0];
        if (!f) { toast("Bitte zuerst eine Backup-Datei auswählen.", "warn"); return; }
        if (f.size > r.max_upload) { toast("Die Datei ist größer als das Upload-Limit dieses Servers (" + fmtBytes(r.max_upload) + ").", "error"); return; }
        if (!(await guardDirty("Backup einspielen"))) return;
        if (!(await G.confirm({ title: "Backup-Datei einspielen?", text: "Der aktuelle Stand wird zuerst automatisch gesichert. Danach werden Ihre Änderungen durch den Inhalt der Datei ersetzt – nur Einträge, die noch zur aktuellen Website passen, werden übernommen.", confirmLabel: "Einspielen", danger: true }))) return;
        up.disabled = true;
        try {
          const fd = new FormData(); fd.append("file", f, f.name);
          const res = await api("backup_restore", { method: "POST", form: fd });
          await reloadContent(); G.invalidateMedia();
          await G.infoDialog("Backup eingespielt", reportNode(res), true);
          draw();
        } catch (e) { toast("Einspielen fehlgeschlagen: " + e.message, "error"); up.disabled = false; }
      } }, icon("upload"), "Datei einspielen");
      host.appendChild(h("section", { class: "card" }, h("h2", { text: "Backup-Datei hochladen und einspielen" }),
        h("p", { class: "field-hint", text: "Eine zuvor heruntergeladene Backup-Datei (.zip oder .json). Maximale Dateigröße auf diesem Server: " + fmtBytes(r.max_upload) + "." }),
        fi, h("div", { class: "btn-row" }, up)));
    }

    async function restoreStored(b, redraw) {
      if (!(await guardDirty("Wiederherstellen"))) return;
      const ok = await G.confirm({
        title: "Diesen Stand wiederherstellen?",
        text: h("div", null, h("p", null, "Ihre aktuellen Änderungen werden durch den Stand aus dem Backup vom ", h("strong", { text: fmtDate(b.created_at || b.mtime) }), " ersetzt."),
          h("p", { text: "Vorher wird automatisch ein weiteres Backup des jetzigen Standes angelegt, sodass Sie jederzeit zurückkehren können. Nur Einträge, die noch zur aktuellen Website passen, werden übernommen.", class: "field-hint" })),
        confirmLabel: "Wiederherstellen", danger: true,
      });
      if (!ok) return;
      try {
        const res = await api("backup_restore", { method: "POST", json: { file: b.file } });
        await reloadContent(); G.invalidateMedia();
        await G.infoDialog("Wiederherstellung abgeschlossen", reportNode(res), true);
        redraw();
      } catch (e) { toast("Wiederherstellung fehlgeschlagen: " + e.message, "error"); }
    }
    draw();
  }

  /* ================= Verlauf ================= */
  async function renderHistory(container) {
    container.appendChild(pageHead("Verlauf", "Vor jeder Änderung wird der bisherige Stand automatisch festgehalten (die letzten 50). So können Sie Änderungen rückgängig machen."));
    const host = h("div"); container.appendChild(host); host.appendChild(loading());
    let r;
    try { r = await api("revisions"); } catch (e) { clear(host); host.appendChild(errBox(e.message)); return; }
    clear(host);
    if (!r.revisions.length) { host.appendChild(h("div", { class: "empty-state" }, icon("clock", "big"), h("p", { text: "Noch keine Änderungen vorhanden." }))); return; }
    const list = h("div", { class: "card" });
    r.revisions.forEach((rev) => {
      list.appendChild(h("div", { class: "backup-row" },
        h("div", { class: "b-main" }, h("div", { class: "b-title" }, h("strong", { text: fmtDate(rev.ts) })), h("div", { class: "b-note", text: rev.note || "Änderung" }),
          h("div", { class: "field-hint", text: "Stand davor: " + rev.override_count + (rev.override_count === 1 ? " geändertes Feld" : " geänderte Felder") })),
        h("div", { class: "b-actions" }, h("button", { type: "button", class: "btn btn-outline btn-small", onclick: async () => {
          if (!(await guardDirty("Zurücksetzen"))) return;
          if (!(await G.confirm({ title: "Auf früheren Stand zurücksetzen?", text: "Die Website wird auf den Stand VOR der Änderung vom " + fmtDate(rev.ts) + " zurückgesetzt. Der jetzige Stand wird vorher im Verlauf festgehalten – Sie können das also wieder rückgängig machen.", confirmLabel: "Zurücksetzen", danger: true }))) return;
          try {
            const res = await api("revision_restore", { method: "POST", json: { id: rev.id } });
            await reloadContent();
            await G.infoDialog("Zurückgesetzt", reportNode(res), true);
            G.route();
          } catch (e) { toast("Fehlgeschlagen: " + e.message, "error"); }
        } }, icon("undo"), "Auf Stand davor zurücksetzen"))));
    });
    host.appendChild(list);
  }

  /* ================= Einstellungen ================= */
  async function renderSettings(container) {
    container.appendChild(pageHead("Einstellungen", "Passwort, Systemprüfung und Wartung."));
    const host = h("div"); container.appendChild(host);

    // --- Passwort
    const cur = h("input", { class: "input", type: "password", autocomplete: "current-password", id: "pwCur" });
    const n1 = h("input", { class: "input", type: "password", autocomplete: "new-password", id: "pwNew", minlength: "10" });
    const n2 = h("input", { class: "input", type: "password", autocomplete: "new-password", id: "pwNew2" });
    const msg = h("div", { class: "form-msg", role: "alert" });
    const pwBtn = h("button", { type: "submit", class: "btn btn-primary" }, "Passwort ändern");
    const pwForm = h("form", { class: "stack", novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = ""; msg.className = "form-msg";
      if (n1.value.length < 10) { msg.textContent = "Das neue Passwort muss mindestens 10 Zeichen lang sein."; msg.classList.add("err"); n1.focus(); return; }
      if (n1.value !== n2.value) { msg.textContent = "Die beiden neuen Passwörter stimmen nicht überein."; msg.classList.add("err"); n2.focus(); return; }
      pwBtn.disabled = true;
      try {
        const r = await api("password_change", { method: "POST", json: { current: cur.value, new: n1.value } });
        if (r.csrf) G.session.csrf = r.csrf;
        G.session.passwordInitial = false;
        cur.value = n1.value = n2.value = "";
        msg.textContent = "Passwort geändert."; msg.classList.add("ok");
        toast("Passwort geändert.");
      } catch (er) { msg.textContent = er.message; msg.classList.add("err"); }
      pwBtn.disabled = false;
    } },
      h("label", { class: "mini-label", for: "pwCur" }, "Aktuelles Passwort", cur),
      h("label", { class: "mini-label", for: "pwNew" }, "Neues Passwort (mindestens 10 Zeichen)", n1),
      h("label", { class: "mini-label", for: "pwNew2" }, "Neues Passwort wiederholen", n2), msg, h("div", { class: "btn-row" }, pwBtn));
    host.appendChild(h("section", { class: "card" }, h("h2", { text: "Passwort ändern" }), pwForm));

    // --- Systemprüfung
    const sys = h("section", { class: "card" }, h("h2", { text: "Systemprüfung" }));
    host.appendChild(sys); sys.appendChild(loading());
    api("health").then(async (r) => {
      clear(sys); sys.appendChild(h("h2", { text: "Systemprüfung" }));
      r.checks.forEach((c) => sys.appendChild(checkRow(c)));
      // Ist data/ von außen erreichbar? (Test aus Sicht des Browsers)
      const row = h("div", { class: "check-row" }, icon("clock"), h("div", null, h("strong", { text: "Datenordner geschützt?" }), h("span", { class: "check-detail", text: " – prüfe …" })));
      sys.appendChild(row);
      let exposed = null;
      try { const t = await fetch("../data/site.sqlite", { method: "HEAD", cache: "no-store" }); exposed = t.ok; } catch (e) { exposed = false; }
      const ok = exposed === false;
      row.className = "check-row " + (ok ? "ok" : "warn"); clear(row);
      row.appendChild(icon(ok ? "check" : "warn"));
      row.appendChild(h("div", null, h("strong", { text: "Datenordner geschützt?" }), h("span", { class: "check-detail", text: ok ? " – data/ ist von außen nicht abrufbar." : " – data/site.sqlite ist über die Website abrufbar!" }),
        ok ? null : h("div", { class: "field-hint", text: "Bitte sicherstellen, dass data/.htaccess wirksam ist (Apache: AllowOverride) oder das Datenverzeichnis per api/config.local.php außerhalb des Webroots ablegen." })));
    }).catch((e) => { clear(sys); sys.appendChild(errBox(e.message)); });

    // --- nicht mehr passende Einträge
    const orph = h("section", { class: "card" }, h("h2", { text: "Nicht mehr passende Einträge" }));
    host.appendChild(orph);
    function drawOrphans() {
      clear(orph); orph.appendChild(h("h2", { text: "Nicht mehr passende Einträge" }));
      const list = G.content.orphans;
      orph.appendChild(h("p", { class: "field-hint", text: "Wenn sich die Struktur der Website später ändert (z. B. ein Feld umbenannt oder entfernt wird), werden gespeicherte Änderungen, die nicht mehr passen, nicht angewendet. Sie bleiben hier gespeichert und können exportiert oder gelöscht werden." }));
      if (!list.length) { orph.appendChild(h("p", { class: "ok-line" }, icon("check"), " Alle gespeicherten Änderungen passen zur aktuellen Website.")); return; }
      const ul = h("div", { class: "orphan-list" });
      list.forEach((o) => ul.appendChild(h("div", { class: "backup-row" },
        h("div", { class: "b-main" }, h("code", { text: o.path }), h("div", { class: "b-note", text: o.reason }),
          h("div", { class: "field-hint", text: "gespeichert " + fmtDate(o.updated_at) + " · " + G.trunc(typeof o.value === "string" ? G.plainText(o.value) : JSON.stringify(o.value), 90) })),
        h("div", { class: "b-actions" },
          h("a", { class: "btn btn-outline btn-small", href: G.API + "?a=orphans_export&path=" + encodeURIComponent(o.path), download: "" }, icon("download"), "Exportieren"),
          h("button", { type: "button", class: "btn btn-outline btn-small danger-text", onclick: () => delOrphans([o.path]) }, icon("trash"), "Löschen")))));
      orph.appendChild(ul);
      orph.appendChild(h("div", { class: "btn-row" },
        h("a", { class: "btn btn-outline", href: G.API + "?a=orphans_export", download: "" }, icon("download"), "Alle exportieren"),
        h("button", { type: "button", class: "btn btn-outline danger-text", onclick: () => delOrphans(list.map((o) => o.path)) }, icon("trash"), "Alle löschen")));
    }
    async function delOrphans(paths) {
      if (!(await G.confirm({ title: paths.length > 1 ? "Alle nicht mehr passenden Einträge löschen?" : "Eintrag löschen?", text: "Diese Einträge werden endgültig aus der Datenbank entfernt (Sie können sie vorher exportieren).", confirmLabel: "Löschen", danger: true }))) return;
      try { await api("orphans_delete", { method: "POST", json: { paths } }); await reloadContent(); toast("Gelöscht."); drawOrphans(); } catch (e) { toast(e.message, "error"); }
    }
    drawOrphans();

    // --- Alles zurücksetzen
    host.appendChild(h("section", { class: "card danger-zone" }, h("h2", { text: "Alles auf Standard zurücksetzen" }),
      h("p", { text: "Entfernt alle Ihre Text-, Bild- und Galerieänderungen; die Website zeigt danach wieder die ausgelieferten Standardinhalte. Hochgeladene Bilddateien bleiben erhalten. Vorher wird automatisch ein Backup angelegt." }),
      h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn btn-danger", onclick: async () => {
        if (!(await guardDirty("Zurücksetzen"))) return;
        if (!(await G.confirm({ title: "Wirklich alles zurücksetzen?", text: "Alle Änderungen an Texten, Bildern und der Galerie gehen verloren (ein Backup wird vorher angelegt).", confirmLabel: "Weiter", danger: true }))) return;
        if (!(await G.confirm({ title: "Letzte Bestätigung", text: "Dies ist die zweite und letzte Sicherheitsabfrage.", typeWord: "ZURÜCKSETZEN", confirmLabel: "Alles zurücksetzen", danger: true }))) return;
        try {
          const r = await api("reset_all", { method: "POST", json: { confirm: "ALLES ZURUECKSETZEN" } });
          await reloadContent();
          toast("Alles zurückgesetzt. Sicherung: " + r.backup);
          G.route();
        } catch (e) { toast("Fehlgeschlagen: " + e.message, "error"); }
      } }, icon("trash"), "Alles auf Standard zurücksetzen"))));
  }

  Object.assign(G, { renderDashboard, renderBackup, renderHistory, renderSettings });
})(window.GSA);
