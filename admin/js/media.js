/* Grundschule Flegessen – Admin: Medien (Upload, Bibliothek, Bildauswahl, Galerie-Manager) */
(function (G) {
  "use strict";
  const { h, icon, api, toast, clear, fmtBytes } = G;
  const E = () => G.editor;
  let cache = null;

  async function loadMedia(force) {
    if (!cache || force) cache = await api("media");
    return cache;
  }
  const invalidate = () => { cache = null; };
  const imgSrc = (f) => "../" + String(f || "").replace(/^\/+/, "");

  /* ---------- Bild vor dem Upload im Browser verkleinern ---------- */
  function hasAlpha(canvas) {
    try {
      const t = document.createElement("canvas");
      t.width = 64; t.height = 64;
      const c = t.getContext("2d");
      c.drawImage(canvas, 0, 0, 64, 64);
      const d = c.getImageData(0, 0, 64, 64).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  async function prepareFile(file) {
    const MAX = 1600;
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { return file; }
    const big = Math.max(bmp.width, bmp.height) > MAX;
    if (!big && file.size <= 1.5 * 1048576) { if (bmp.close) bmp.close(); return file; }
    const s = big ? MAX / Math.max(bmp.width, bmp.height) : 1;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bmp.width * s));
    cv.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = cv.getContext("2d");
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    const type = file.type !== "image/jpeg" && hasAlpha(cv) ? "image/png" : "image/jpeg";
    let out = cv;
    if (type === "image/jpeg" && file.type !== "image/jpeg") { // transparente Flächen weiß füllen
      out = document.createElement("canvas");
      out.width = cv.width; out.height = cv.height;
      const x = out.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, out.width, out.height); x.drawImage(cv, 0, 0);
    }
    const blob = await new Promise((res) => out.toBlob(res, type, 0.86));
    if (!blob || (!big && blob.size >= file.size)) return file;
    const base = (file.name || "bild").replace(/\.[^.]+$/, "");
    return new File([blob], base + (type === "image/png" ? ".png" : ".jpg"), { type });
  }

  /** Mehrere Dateien nacheinander hochladen. onEach(file, result|null, error|null) */
  async function uploadFiles(files, onEach) {
    const out = [];
    for (const f of Array.from(files)) {
      try {
        if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error("„" + f.name + "“: Nur JPEG-, PNG- und WebP-Bilder sind erlaubt.");
        const blob = await prepareFile(f);
        if (blob.size > 8 * 1048576) throw new Error("„" + f.name + "“ ist auch nach dem Verkleinern größer als 8 MB.");
        const fd = new FormData();
        fd.append("file", blob, blob.name || f.name);
        const r = await api("upload", { method: "POST", form: fd });
        invalidate();
        out.push(r);
        if (onEach) onEach(f, r, null);
      } catch (e) {
        toast(e.message, "error");
        if (onEach) onEach(f, null, e);
      }
    }
    return out;
  }
  G.uploadFiles = uploadFiles;

  /* ---------- Bildauswahl (Dialog) ---------- */
  function mediaCard(m, opts) {
    opts = opts || {};
    const btn = h("button", { type: "button", class: "media-pick", "aria-pressed": "false", title: m.file },
      h("img", { src: imgSrc(m.thumb || m.file), alt: "", loading: "lazy" }),
      h("span", { class: "mp-name", text: m.name || m.file }));
    return btn;
  }

  /** Bildauswahl. opts: {title, multi} -> Promise<Array<media>|null> */
  async function pickImage(opts) {
    opts = opts || {};
    let lib;
    try { lib = await loadMedia(true); } catch (e) { toast("Bilderliste konnte nicht geladen werden: " + e.message, "error"); return null; }
    const selected = new Map();
    let tab = lib.uploads.length ? "uploads" : "site";
    let query = "";
    let closeFn = null;
    const grid = h("div", { class: "media-grid pick-grid", role: "group", "aria-label": "Bilder" });
    const tabs = h("div", { class: "tabs", role: "tablist" });
    const search = h("input", { class: "input", type: "search", placeholder: "Suchen (Dateiname, Ordner) …", "aria-label": "Bilder suchen" });
    const info = h("p", { class: "field-hint" });
    const okBtnLabel = () => selected.size ? selected.size + " Bild" + (selected.size === 1 ? "" : "er") + " übernehmen" : "Übernehmen";

    function draw() {
      clear(grid); clear(tabs);
      [["uploads", "Meine Bilder (" + lib.uploads.length + ")"], ["site", "Bilder der Website (" + lib.site.length + ")"]].forEach(([k, t]) =>
        tabs.appendChild(h("button", { type: "button", class: "tab" + (k === tab ? " active" : ""), role: "tab", "aria-selected": String(k === tab), onclick: () => { tab = k; draw(); } }, t)));
      const q = query.trim().toLowerCase();
      let items = (tab === "uploads" ? lib.uploads : lib.site).filter((m) => !q || (m.file + " " + (m.name || "") + " " + (m.alt || "")).toLowerCase().includes(q));
      const total = items.length;
      items = items.slice(0, 150);
      items.forEach((m) => {
        const b = mediaCard(m);
        const sync = () => b.setAttribute("aria-pressed", String(selected.has(m.file)));
        sync();
        b.addEventListener("click", () => {
          if (!opts.multi) { if (closeFn) closeFn({ ok: true, list: [m] }); return; }
          if (selected.has(m.file)) selected.delete(m.file); else selected.set(m.file, m);
          sync();
          const ok = document.getElementById("pickOk");
          if (ok) { ok.textContent = okBtnLabel(); ok.disabled = !selected.size; }
        });
        grid.appendChild(b);
      });
      if (!items.length) grid.appendChild(h("p", { class: "empty-note", text: tab === "uploads" ? "Noch keine eigenen Bilder hochgeladen." : "Keine Treffer." }));
      info.textContent = total > 150 ? "Es werden die ersten 150 von " + total + " Bildern angezeigt – bitte Suche nutzen." : (tab === "site" ? "Bilder, die zur Website gehören (werden nie verändert)." : "");
    }
    search.addEventListener("input", () => { query = search.value; draw(); });
    const fileInput = h("input", { type: "file", multiple: opts.multi ? true : null, accept: "image/jpeg,image/png,image/webp", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    const upBtn = h("button", { type: "button", class: "btn btn-primary btn-small", onclick: () => fileInput.click() }, icon("upload"), "Neu hochladen");
    fileInput.addEventListener("change", async () => {
      const files = Array.from(fileInput.files || []); fileInput.value = "";
      if (!files.length) return;
      upBtn.disabled = true; upBtn.lastChild.textContent = "Lädt hoch …";
      const res = await uploadFiles(files);
      upBtn.disabled = false; upBtn.lastChild.textContent = "Neu hochladen";
      if (!res.length) return;
      if (!opts.multi) { if (closeFn) closeFn({ ok: true, list: [res[0]] }); return; }
      lib = await loadMedia(true); tab = "uploads";
      res.forEach((r) => { const m = lib.uploads.find((u) => u.file === r.file) || r; selected.set(m.file, m); });
      draw();
      const ok = document.getElementById("pickOk"); if (ok) { ok.textContent = okBtnLabel(); ok.disabled = !selected.size; }
    });
    const body = h("div", { class: "picker" }, h("div", { class: "picker-bar" }, tabs, h("span", { class: "spacer" }), upBtn, fileInput), search, info, grid);
    draw();
    const res = await G.modal({
      title: opts.title || "Bild auswählen", body, wide: true, escValue: null,
      actions: opts.multi ? [{ label: "Abbrechen", kind: "btn-outline", value: null }, { label: "Übernehmen", kind: "btn-primary", value: "ok" }] : [{ label: "Abbrechen", kind: "btn-outline", value: null }],
      onOpen(box, close) {
        closeFn = close;
        const ok = box.querySelector(".dialog-foot .btn-primary");
        if (ok) { ok.id = "pickOk"; ok.disabled = true; }
      },
    });
    if (!res) return null;
    if (res === "ok") return Array.from(selected.values());
    if (res.ok) return res.list;
    return null;
  }
  G.pickImage = pickImage;

  /* ---------- Ansicht: Mediathek ---------- */
  function mediaTabs(active) {
    return h("div", { class: "tabs page-tabs", role: "tablist" },
      h("a", { class: "tab" + (active === "medien" ? " active" : ""), href: "#/medien", role: "tab", "aria-selected": String(active === "medien") }, icon("grid"), "Mediathek"),
      h("a", { class: "tab" + (active === "galerie" ? " active" : ""), href: "#/galerie", role: "tab", "aria-selected": String(active === "galerie") }, icon("image"), "Galerie"));
  }

  async function renderMedia(container) {
    container.appendChild(h("div", { class: "page-head" }, h("div", null, h("h1", { text: "Bilder & Medien" }),
      h("p", { class: "lead", text: "Hochgeladene Bilder verwalten. Die Bilder der Website selbst bleiben unverändert." }))));
    container.appendChild(mediaTabs("medien"));
    const zone = h("div", { class: "dropzone", tabindex: "0", role: "button", "aria-label": "Bilder hochladen: Dateien hierher ziehen oder Enter drücken" });
    const fileInput = h("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    const progress = h("ul", { class: "progress-list", "aria-live": "polite" });
    zone.appendChild(icon("upload", "big"));
    zone.appendChild(h("div", null, h("strong", { text: "Bilder hochladen" }), h("div", { class: "field-hint", text: "Dateien hierher ziehen oder klicken. JPEG, PNG oder WebP – große Fotos werden automatisch verkleinert (max. 1600 px)." })));
    zone.appendChild(fileInput);
    const listHost = h("div");
    container.appendChild(zone); container.appendChild(progress); container.appendChild(listHost);

    async function handle(files) {
      files = Array.from(files || []).filter(Boolean);
      if (!files.length) return;
      const rows = files.map((f) => { const li = h("li", { class: "pending" }, icon("upload"), " ", f.name, " – wird hochgeladen …"); progress.appendChild(li); return li; });
      let i = 0;
      await uploadFiles(files, (f, r, err) => {
        const li = rows[i++];
        li.className = err ? "err" : "done";
        clear(li); li.appendChild(icon(err ? "warn" : "check")); li.appendChild(document.createTextNode(" " + f.name + (err ? " – fehlgeschlagen" : " – fertig")));
      });
      await draw(true);
      setTimeout(() => clear(progress), 6000);
    }
    zone.addEventListener("click", (e) => { if (e.target !== fileInput) fileInput.click(); });
    zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
    fileInput.addEventListener("change", () => { const f = fileInput.files; handle(f).then(() => { fileInput.value = ""; }); });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", (e) => handle(e.dataTransfer && e.dataTransfer.files));

    async function draw(force) {
      clear(listHost);
      listHost.appendChild(h("p", { class: "loading", text: "Lade Bilder …" }));
      let lib;
      try { lib = await loadMedia(force); } catch (e) { clear(listHost); listHost.appendChild(h("div", { class: "notice error", text: "Bilder konnten nicht geladen werden: " + e.message })); return; }
      clear(listHost);
      listHost.appendChild(h("h2", { class: "section-title", text: "Meine hochgeladenen Bilder (" + lib.uploads.length + ")" }));
      if (!lib.uploads.length) listHost.appendChild(h("div", { class: "empty-state" }, icon("image", "big"), h("p", { text: "Noch keine Bilder hochgeladen." })));
      const grid = h("div", { class: "media-grid" });
      lib.uploads.forEach((m) => grid.appendChild(uploadCard(m, draw)));
      listHost.appendChild(grid);

      // Bilder der Website (nur lesen)
      const det = h("details", { class: "site-images" }, h("summary", null, h("span", { class: "chev" }, icon("chevron")), "Bilder der Website ansehen (" + lib.site.length + ", nur lesend)"));
      const q = h("input", { class: "input", type: "search", placeholder: "Suchen …", "aria-label": "Bilder der Website suchen" });
      const g2 = h("div", { class: "media-grid" });
      const more = h("button", { type: "button", class: "btn btn-outline btn-small", hidden: true }, "Weitere anzeigen");
      let shown = 60;
      function drawSite() {
        clear(g2);
        const s = q.value.trim().toLowerCase();
        const items = lib.site.filter((m) => !s || m.file.toLowerCase().includes(s));
        items.slice(0, shown).forEach((m) => g2.appendChild(h("div", { class: "media-card site" },
          h("div", { class: "mc-img" }, h("img", { src: imgSrc(m.file), alt: "", loading: "lazy" })),
          h("div", { class: "mc-body" }, h("div", { class: "mc-name", text: m.file.replace(/^assets\/images\//, ""), title: m.file }),
            h("div", { class: "mc-meta", text: fmtBytes(m.bytes) + (m.used ? " · verwendet: " + m.used + "×" : "") }),
            h("button", { type: "button", class: "btn btn-outline btn-small", onclick: () => G.copyText(m.file) }, icon("copy"), "Pfad kopieren")))));
        more.hidden = items.length <= shown;
        more.textContent = "Weitere anzeigen (" + Math.max(0, items.length - shown) + ")";
        if (!items.length) g2.appendChild(h("p", { class: "empty-note", text: "Keine Treffer." }));
      }
      more.addEventListener("click", () => { shown += 60; drawSite(); });
      q.addEventListener("input", () => { shown = 60; drawSite(); });
      det.appendChild(h("div", { class: "det-body" }, q, g2, more));
      let init = false;
      det.addEventListener("toggle", () => { if (det.open && !init) { init = true; drawSite(); } });
      listHost.appendChild(det);
    }
    await draw(true);
  }

  function uploadCard(m, redraw) {
    const alt = h("input", { class: "input", type: "text", value: m.alt || "", maxlength: "300", "aria-label": "Alt-Text für " + (m.name || m.file), placeholder: "Bildbeschreibung (Alt-Text)" });
    const state = h("span", { class: "field-hint", "aria-live": "polite" });
    alt.addEventListener("change", async () => {
      try {
        await api("media_alt", { method: "POST", json: { file: m.file, alt: alt.value } });
        m.alt = alt.value; state.textContent = "Gespeichert.";
        setTimeout(() => { state.textContent = ""; }, 2500);
      } catch (e) { state.textContent = ""; toast("Alt-Text nicht gespeichert: " + e.message, "error"); }
    });
    const del = h("button", { type: "button", class: "btn btn-outline btn-small danger-text", onclick: () => deleteMedia(m, redraw) }, icon("trash"), "Löschen");
    return h("div", { class: "media-card" },
      h("div", { class: "mc-img" }, h("img", { src: imgSrc(m.thumb || m.file), alt: "", loading: "lazy" })),
      h("div", { class: "mc-body" },
        h("div", { class: "mc-name", text: m.name || m.file, title: m.file }),
        h("div", { class: "mc-meta", text: (m.width ? m.width + "×" + m.height + " px · " : "") + fmtBytes(m.bytes) }),
        m.used ? h("span", { class: "badge badge-info", text: "verwendet: " + m.used + "×" }) : h("span", { class: "badge", text: "nicht verwendet" }),
        h("label", { class: "mini-label" }, "Alt-Text", alt), state,
        h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn btn-outline btn-small", onclick: () => G.copyText(m.file) }, icon("copy"), "Pfad kopieren"), del)));
  }

  async function deleteMedia(m, redraw, force) {
    if (!force && !(await G.confirm({ title: "Bild löschen?", text: "„" + (m.name || m.file) + "“ wird endgültig vom Server gelöscht.", confirmLabel: "Löschen", danger: true }))) return;
    try {
      await api("media_delete", { method: "POST", json: { file: m.file, force: !!force } });
      toast("Bild gelöscht.");
      invalidate(); redraw(true);
    } catch (e) {
      if (e.status === 409 && e.data && e.data.used_in) {
        const ul = h("ul", { class: "err-list" }); e.data.used_in.slice(0, 12).forEach((p) => ul.appendChild(h("li", { text: p })));
        const ok = await G.confirm({ title: "Bild wird noch verwendet", danger: true, confirmLabel: "Trotzdem löschen",
          text: h("div", null, h("p", { text: "Dieses Bild ist noch eingebunden. Wenn Sie es löschen, erscheint dort ein leerer Bildplatz:" }), ul) });
        if (ok) deleteMedia(m, redraw, true);
      } else toast("Löschen fehlgeschlagen: " + e.message, "error");
    }
  }

  /* ---------- Ansicht: Galerie-Manager ---------- */
  function galleryItemFrom(m, sample) {
    const keys = sample ? Object.keys(sample) : ["slug", "jpg", "webp", "thumbJpg", "thumbWebp", "alt"];
    const base = String(m.file).split("/").pop().replace(/\.[^.]+$/, "");
    const item = {};
    keys.forEach((k) => {
      const sv = sample ? sample[k] : "";
      if (k === "slug") item[k] = base;
      else if (k === "alt") item[k] = m.alt || "";
      else if (/^w(idth)?$/i.test(k)) item[k] = m.width || 0;
      else if (/^h(eight)?$/i.test(k)) item[k] = m.height || 0;
      else if (typeof sv === "string" && /\.(jpe?g|png|webp)$/i.test(sv) || /jpg|webp|mid|thumb/i.test(k)) {
        if (/thumb/i.test(k) && /webp/i.test(k)) item[k] = m.thumbWebp || "";
        else if (/thumb/i.test(k)) item[k] = m.thumb || m.file;
        else if (/webp/i.test(k)) item[k] = m.webp || "";
        else item[k] = m.file;
      } else item[k] = typeof sv === "number" ? 0 : typeof sv === "boolean" ? false : "";
    });
    return item;
  }

  let galleryShown = 48;
  async function renderGallery(container) {
    const Ed = E();
    Ed.resetRegistry();
    container.appendChild(h("div", { class: "page-head" }, h("div", null, h("h1", { text: "Bilder & Medien" }),
      h("p", { class: "lead", text: "Fotos der Galerie hinzufügen, entfernen, umsortieren und beschriften. Änderungen wirken nach „Speichern“." }))));
    container.appendChild(mediaTabs("galerie"));
    const host = h("div", { class: "card group" });
    container.appendChild(host);
    Ed.galleryUnitField(host, (ctrl, changed, rebuild) => buildGallery(ctrl, changed, rebuild));
  }

  function buildGallery(ctrl, changed, rebuild) {
    const Ed = E();
    const S = Ed.S;
    const items = S.draft.gallery.items;
    const defItems = S.defaults.gallery.items;
    const sample = Ed.richestSample(items, defItems);
    const rerender = () => rebuild();

    async function addFrom(list) {
      if (!list || !list.length) return;
      const news = list.map((m) => galleryItemFrom(m, sample));
      items.unshift.apply(items, news);
      galleryShown = Math.max(galleryShown, 48);
      changed(); rerender();
      toast(news.length + " Bild" + (news.length === 1 ? "" : "er") + " zur Galerie hinzugefügt (vorn eingefügt, noch nicht gespeichert).");
    }
    const addBtn = h("button", { type: "button", class: "btn btn-primary btn-small", onclick: async () => addFrom(await pickImage({ title: "Bilder zur Galerie hinzufügen", multi: true })) }, icon("plus"), "Bilder hinzufügen");
    const fi = h("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    const upBtn = h("button", { type: "button", class: "btn btn-outline btn-small", onclick: () => fi.click() }, icon("upload"), "Neue Fotos hochladen");
    fi.addEventListener("change", async () => {
      const files = Array.from(fi.files || []); fi.value = "";
      if (!files.length) return;
      upBtn.disabled = true;
      const res = await uploadFiles(files);
      upBtn.disabled = false;
      await addFrom(res);
    });
    ctrl.appendChild(h("div", { class: "btn-row toolbar" }, addBtn, upBtn, fi, h("span", { class: "field-hint", text: items.length + " Bilder in der Galerie" })));

    const grid = h("div", { class: "gallery-grid" });
    let dragFrom = null;
    items.slice(0, galleryShown).forEach((it, i) => {
      const thumb = it.thumbJpg || it.jpg || "";
      const alt = h("input", { class: "input", type: "text", value: it.alt || "", maxlength: "300", "aria-label": "Alt-Text zu Bild " + (i + 1), placeholder: "Bildbeschreibung" });
      alt.addEventListener("input", () => { it.alt = alt.value; changed(); });
      const mv = (d) => () => {
        const j = i + d; if (j < 0 || j >= items.length) return;
        [items[i], items[j]] = [items[j], items[i]]; changed(); rerender();
        const b = ctrl.querySelector('[data-gi="' + j + '"] .gi-' + (d < 0 ? "l" : "r")); if (b && !b.disabled) b.focus();
      };
      const card = h("div", { class: "gallery-item", "data-gi": i, draggable: "true" },
        h("div", { class: "gi-img" }, h("span", { class: "gi-num", text: String(i + 1) }), h("img", { src: imgSrc(thumb), alt: "", loading: "lazy", draggable: "false" })),
        alt,
        h("div", { class: "gi-actions" },
          h("button", { type: "button", class: "icon-btn gi-l", "aria-label": "Bild " + (i + 1) + " nach vorn", title: "Nach vorn", disabled: i === 0, onclick: mv(-1) }, icon("left")),
          h("button", { type: "button", class: "icon-btn gi-r", "aria-label": "Bild " + (i + 1) + " nach hinten", title: "Nach hinten", disabled: i === items.length - 1, onclick: mv(1) }, icon("right")),
          h("button", { type: "button", class: "icon-btn danger", "aria-label": "Bild " + (i + 1) + " aus der Galerie entfernen", title: "Aus der Galerie entfernen", onclick: async () => {
            if (!(await G.confirm({ title: "Aus der Galerie entfernen?", text: "Das Foto wird nur aus der Galerie genommen – die Bilddatei bleibt erhalten.", confirmLabel: "Entfernen", danger: true }))) return;
            items.splice(i, 1); changed(); rerender();
          } }, icon("trash"))));
      card.addEventListener("dragstart", (e) => { dragFrom = i; card.classList.add("dragging"); if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); } });
      card.addEventListener("dragend", () => { card.classList.remove("dragging"); dragFrom = null; });
      card.addEventListener("dragover", (e) => { if (dragFrom !== null) { e.preventDefault(); card.classList.add("drop"); } });
      card.addEventListener("dragleave", () => card.classList.remove("drop"));
      card.addEventListener("drop", (e) => {
        e.preventDefault(); card.classList.remove("drop");
        if (dragFrom === null || dragFrom === i) return;
        const [moved] = items.splice(dragFrom, 1); items.splice(i, 0, moved);
        dragFrom = null; changed(); rerender();
      });
      grid.appendChild(card);
    });
    if (!items.length) grid.appendChild(h("p", { class: "empty-note", text: "Die Galerie ist leer." }));
    ctrl.appendChild(grid);
    if (items.length > galleryShown) {
      ctrl.appendChild(h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn btn-outline", onclick: () => { galleryShown += 48; rerender(); } }, "Weitere anzeigen (" + (items.length - galleryShown) + ")")));
    }
    ctrl.appendChild(h("p", { class: "field-hint", text: "Tipp: Fotos lassen sich auch per Ziehen und Ablegen umsortieren." }));
  }

  Object.assign(G, { renderMedia, renderGallery, loadMedia, invalidateMedia: invalidate });
})(window.GSA);
