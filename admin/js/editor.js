/* Grundschule Flegessen – Admin: Inhalts-Editor (generischer, rekursiver Formular-Renderer) */
(function (G) {
  "use strict";
  const { h, icon, api, toast, clone, clear } = G;

  /* ================= Zustand ================= */
  const S = (G.content = {
    defaults: null, effective: null, draft: null, overridden: {}, orphans: [], rev: 0,
    dirty: new Set(), loaded: false,
  });
  const registry = {}; // Einheit (Pfad) -> [refresh-Funktionen]
  let barHook = null;
  G.onDirtyChange = (fn) => { barHook = fn; };

  /* ================= Hilfen: Pfade, Typen, Vergleich ================= */
  const isArr = Array.isArray;
  const isObj = (v) => v !== null && typeof v === "object" && !isArr(v);
  const isImage = (v) => isObj(v) && "file" in v && "alt" in v;
  function cls(v) {
    if (v === null || v === undefined) return "null";
    if (isArr(v)) return "array";
    if (isObj(v)) return isImage(v) ? "image" : "object";
    return typeof v; // string | number | boolean
  }
  function getAt(tree, path) {
    let c = tree;
    for (const seg of path.split(".")) {
      if (c === null || typeof c !== "object" || isArr(c)) return undefined;
      c = c[seg];
    }
    return c;
  }
  function setAt(tree, path, val) {
    const segs = path.split(".");
    let c = tree;
    for (let i = 0; i < segs.length - 1; i++) { if (!isObj(c[segs[i]])) c[segs[i]] = {}; c = c[segs[i]]; }
    c[segs[segs.length - 1]] = val;
  }
  /** Überschreibbare Einheiten: Skalare, Bildobjekte, ganze Listen. */
  function unitsOf(tree, prefix, out) {
    out = out || {};
    for (const k of Object.keys(tree)) {
      const p = prefix ? prefix + "." + k : k;
      const v = tree[k];
      if (cls(v) === "object") unitsOf(v, p, out); else out[p] = cls(v);
    }
    return out;
  }
  function norm(v) {
    if (isArr(v)) return v.map(norm);
    if (isObj(v)) {
      const o = {};
      for (const k of Object.keys(v).sort()) {
        const x = norm(v[k]);
        if (x === "" || x === null || x === undefined || (isArr(x) && !x.length) || (isObj(x) && !Object.keys(x).length)) continue;
        o[k] = x;
      }
      return o;
    }
    return v;
  }
  function canon(v) {
    if (isArr(v)) return "[" + v.map(canon).join(",") + "]";
    if (isObj(v)) return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  const eqDefault = (unit) => canon(norm(getAt(S.draft, unit))) === canon(norm(getAt(S.defaults, unit)));
  const eqEffective = (unit) => canon(norm(getAt(S.draft, unit))) === canon(norm(getAt(S.effective, unit)));

  /* ================= Laden / Patch / Speichern ================= */
  async function loadContent() {
    const r = await api("admin_content");
    S.defaults = r.defaults; S.effective = r.effective; S.draft = clone(r.effective);
    S.overridden = r.overridden || {}; S.orphans = r.orphans || []; S.rev = r.rev;
    S.units = unitsOf(r.defaults);
    S.dirty.clear(); G.dirtyCount = 0;
    S.loaded = true;
    if (barHook) barHook();
    return r;
  }

  function computePatch() {
    const patch = {};
    for (const u of S.dirty) patch[u] = eqDefault(u) ? null : clone(getAt(S.draft, u));
    return patch;
  }

  function touch(unit) {
    if (eqEffective(unit)) S.dirty.delete(unit); else S.dirty.add(unit);
    G.dirtyCount = S.dirty.size;
    (registry[unit] || []).forEach((fn) => fn());
    if (barHook) barHook();
  }
  function register(unit, fn) { (registry[unit] = registry[unit] || []).push(fn); }
  function resetRegistry() { for (const k of Object.keys(registry)) delete registry[k]; }

  async function save(note) {
    const patch = computePatch();
    if (!Object.keys(patch).length) { toast("Keine Änderungen zum Speichern."); return true; }
    try {
      const r = await api("save", { method: "POST", json: { patch, note: note || "" } });
      await loadContent();
      toast(r.changed ? "Gespeichert – " + (r.changed === 1 ? "1 Änderung ist" : r.changed + " Änderungen sind") + " jetzt online." : "Gespeichert.");
      return true;
    } catch (e) {
      if (e.status === 422 && e.data && e.data.errors) showSaveErrors(e.data.errors);
      else toast("Speichern fehlgeschlagen: " + e.message, "error");
      return false;
    }
  }

  function showSaveErrors(errors) {
    const list = h("ul", { class: "err-list" });
    Object.keys(errors).forEach((p) => list.appendChild(h("li", null, h("strong", { text: pathLabel(p) }), h("div", { text: errors[p] }))));
    G.infoDialog("Nicht gespeichert – bitte prüfen", h("div", null,
      h("p", { text: "Es wurde nichts gespeichert, weil einige Angaben nicht zulässig sind:" }), list));
  }

  async function discard() {
    if (S.dirty.size && !(await G.confirm({ title: "Änderungen verwerfen?", text: "Alle ungespeicherten Änderungen gehen verloren.", confirmLabel: "Verwerfen", danger: true }))) return false;
    await loadContent();
    return true;
  }

  /* ================= Beschriftungen ================= */
  const KEY_LABELS = {
    pageTitle: "Seitentitel", metaDescription: "Beschreibung für Suchmaschinen (Meta-Description)", heroImage: "Titelbild",
    introHtml: "Einleitungstext", html: "Text", name: "Name", role: "Funktion", photo: "Foto", teacher: "Klassenlehrkraft",
    date: "Datum", title: "Überschrift", description: "Beschreibung", file: "Datei / Link-Ziel", question: "Frage", answer: "Antwort",
    label: "Bezeichnung", time: "Uhrzeit", note: "Anmerkung", image: "Bild", alt: "Alt-Text", text: "Text", slug: "Kennung",
    jpg: "Bilddatei (JPEG)", webp: "Bilddatei (WebP)", thumbJpg: "Vorschaubild (JPEG)", thumbWebp: "Vorschaubild (WebP)", mid: "Bilddatei (mittel)",
    w: "Breite (px)", h: "Höhe (px)", members: "Team-Mitglieder", classes: "Klassen", rows: "Zeiten", faq: "Häufige Fragen",
    documents: "Dokumente", posts: "Beiträge", items: "Bilder", updatedLabel: "Beschriftung „Aktualisiert am“", updatedDate: "Datum der Aktualisierung",
    moreLabel: "Hinweis unter den Beiträgen", logo: "Logo", ogImage: "Vorschaubild für soziale Netzwerke",
  };
  const PATH_LABELS = {
    "site.name": "Name der Schule", "site.shortName": "Kurzname", "site.claim": "Leitspruch", "site.metaDescription": "Beschreibung für Suchmaschinen",
    "site.phone": "Telefon", "site.phoneHref": "Telefon (Link-Ziel, z. B. tel:+49…)", "site.email": "E-Mail-Adresse", "site.street": "Straße und Hausnummer",
    "site.zip": "Postleitzahl", "site.city": "Ort", "site.region": "Bundesland", "site.country": "Land (Kürzel)", "site.principal": "Schulleitung",
    "site.mapEmbedUrl": "Karten-Adresse (OpenStreetMap-Einbettung)",
  };
  const SUFFIXES = [
    ["CtaLabel", "Button-Text"], ["CtaHref", "Button-Link"], ["Eyebrow", "Kleine Überschrift"], ["Title", "Überschrift"], ["Html", "Text"],
    ["Text", "Text"], ["Image", "Bild"], ["Label", "Beschriftung"], ["Href", "Link-Ziel"], ["Claim", "Leitspruch"], ["Value", "Wert"],
    ["Date", "Datum"], ["Description", "Beschreibung"], ["Url", "Adresse"],
  ];
  const WORDS = {
    hero: "Titelbereich", intro: "Einleitung", quick: "Kennzahl", fact: "", highlight: "Highlight", schulalltag: "Schulalltag", schullied: "Schullied",
    leitbild: "Leitbild", stat: "Zahl", stats: "Zahlen", history: "Geschichte", special: "Besonderes", new: "Neue", parents: "Eltern", eltern: "Eltern",
    einschulung: "Einschulung", gremien: "Gremien", kontakt: "Kontakt", infos: "Infos", betreuung: "Betreuung", konzepte: "Konzepte",
    downloads: "Downloads", faq: "Häufige Fragen", primary: "Haupt-", secondary: "Neben-", updated: "Aktualisierung", form: "Formular",
    more: "Weitere", map: "Karte", embed: "Einbettung", meta: "Meta", page: "Seite",
  };
  const GROUP_TITLES = {
    seite: "Seite & Suchmaschinen", hero: "Titelbereich", quick: "Kennzahlen", intro: "Einleitung", schulalltag: "Schulalltag", highlight: "Highlights",
    eltern: "Infos für Eltern", infos: "Infos", gremien: "Gremien", kontakt: "Kontakt", new: "Neue Eltern / Einschulung", history: "Geschichte",
    stats: "Zahlen", stat: "Zahlen", special: "Was uns besonders macht", leitbild: "Leitbild", schullied: "Schullied", betreuung: "Betreuung & Ganztag",
    konzepte: "Konzepte & Mitteilungen", faq: "Häufige Fragen", einschulung: "Einschulung", downloads: "Downloads", updated: "Aktualisierung",
    form: "Kontaktformular", more: "Weitere Neuigkeiten",
    s_schule: "Schule", s_kontakt: "Kontakt & Adresse", s_bilder: "Logo & Bilder", s_karte: "Karte", s_seo: "Suchmaschinen",
  };
  const SITE_GROUP = {
    name: "s_schule", shortName: "s_schule", claim: "s_schule", principal: "s_schule", metaDescription: "s_seo",
    phone: "s_kontakt", phoneHref: "s_kontakt", email: "s_kontakt", street: "s_kontakt", zip: "s_kontakt", city: "s_kontakt", region: "s_kontakt", country: "s_kontakt",
    logo: "s_bilder", ogImage: "s_bilder", mapEmbedUrl: "s_karte",
  };

  function splitSuffix(key) {
    for (const [suf, txt] of SUFFIXES) if (key.length > suf.length && key.endsWith(suf)) return [key.slice(0, -suf.length), txt];
    return [key, ""];
  }
  function humanize(s) {
    return s.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2").replace(/[-_]/g, " ")
      .split(" ").map((w) => (WORDS[w.toLowerCase()] !== undefined ? WORDS[w.toLowerCase()] : w)).filter(Boolean).join(" ").replace("- ", "-");
  }
  function labelFor(key, path) {
    if (path && PATH_LABELS[path]) return PATH_LABELS[path];
    if (KEY_LABELS[key]) return KEY_LABELS[key];
    const [subject, suffix] = splitSuffix(key);
    const subj = humanize(subject);
    let out = subj ? (suffix ? subj + ": " + suffix : subj) : suffix;
    out = out || key;
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  function groupId(prefix, key) {
    if (prefix === "site") return SITE_GROUP[key] || "s_schule";
    if (key === "pageTitle" || key === "metaDescription") return "seite";
    const m = key.match(/^[a-z]+/);
    const id = m ? m[0] : key;
    return GROUP_ALIAS[id] || id;
  }
  const GROUP_ALIAS = { stats: "stat" };
  function groupTitle(id) { return GROUP_TITLES[id] || (id.charAt(0).toUpperCase() + id.slice(1)); }

  const PAGE_FILES = { home: "index.html" };
  function pageFile(key) { return key === "site" ? "index.html" : (PAGE_FILES[key] || key + ".html"); }
  function pageLabel(key) {
    if (key === "site") return "Allgemein (Schule, Kontakt, Logo)";
    if (key === "home" && !(S.effective.pages.home && S.effective.pages.home.pageTitle)) return "Startseite";
    const p = S.effective && S.effective.pages && S.effective.pages[key];
    const d = S.defaults && S.defaults.pages && S.defaults.pages[key];
    return (p && p.pageTitle) || (d && d.pageTitle) || key;
  }
  function pageKeys() { return ["site"].concat(Object.keys((S.defaults && S.defaults.pages) || {})); }
  function pathLabel(path) {
    const parts = path.split(".");
    if (parts[0] === "gallery") return "Galerie › Bilder";
    if (parts[0] === "site") return "Allgemein › " + labelFor(parts[parts.length - 1], path);
    return pageLabel(parts[1]) + " › " + labelFor(parts[parts.length - 1], path);
  }
  function unitsUnder(key) {
    const prefix = key === "site" ? "site." : "pages." + key + ".";
    return Object.keys(S.units).filter((u) => u.startsWith(prefix));
  }
  function pageChangedCount(key) {
    return unitsUnder(key).filter((u) => !eqDefault(u)).length;
  }

  /* ================= Feld-Rahmen ================= */
  function badges(unit) {
    const mod = h("span", { class: "badge badge-mod", title: "Weicht vom ausgelieferten Standard ab", hidden: true, text: "geändert" });
    const dirty = h("span", { class: "badge badge-dirty", title: "Noch nicht gespeichert", hidden: true, text: "nicht gespeichert" });
    return { mod, dirty };
  }

  /** Feld, das eine überschreibbare Einheit ist (mit „geändert“-Anzeige und Zurücksetzen). */
  function unitField(container, o) {
    const { path, label, hint, build, extraClass } = o;
    const b = badges(path);
    const ctrl = h("div", { class: "field-ctrl" });
    const resetBtn = h("button", { type: "button", class: "btn-link", hidden: true, "aria-label": "Auf Standard zurücksetzen: " + label,
      onclick: async () => {
        setAt(S.draft, path, clone(getAt(S.defaults, path)));
        touch(path);
        render();
        toast("„" + label + "“ auf Standard zurückgesetzt (noch nicht gespeichert).");
      } }, icon("undo"), " Auf Standard zurücksetzen");
    const wrap = h("div", { class: "field " + (extraClass || ""), "data-path": path },
      h("div", { class: "field-head" }, h("span", { class: "field-label", text: label }), b.mod, b.dirty, h("span", { class: "spacer" }), resetBtn),
      ctrl, hint ? h("div", { class: "field-hint", text: hint }) : null,
      h("div", { class: "field-path", text: path }));
    function refresh() {
      b.mod.hidden = eqDefault(path);
      resetBtn.hidden = b.mod.hidden;
      b.dirty.hidden = !S.dirty.has(path);
    }
    function render() { clear(ctrl); build(ctrl, () => touch(path), render); refresh(); }
    register(path, refresh);
    container.appendChild(wrap);
    render();
    return wrap;
  }

  /** Feld innerhalb einer Liste (gehört zur Einheit der Liste). */
  function nestedField(container, o) {
    const ctrl = h("div", { class: "field-ctrl" });
    const wrap = h("div", { class: "field nested", "data-path": o.path },
      h("div", { class: "field-head" }, h("span", { class: "field-label", text: o.label })), ctrl);
    container.appendChild(wrap);
    o.build(ctrl);
  }

  function field(container, ctx, o) {
    if (ctx.unit) nestedField(container, { path: o.path, label: o.label, build: (ctrl) => o.build(ctrl, () => touch(ctx.unit), null) });
    else unitField(container, o);
  }

  /* ================= String-Felder ================= */
  const TAG_RE = /<\/?[a-z][^>]*>/i;
  const ENTITY_RE = /&(amp|lt|gt|quot|nbsp|#\d+);/;
  function stringKind(key, value, def) {
    if (/(Href|Url)$/.test(key) || key === "file") return "link";
    if (TAG_RE.test(value || "") || TAG_RE.test(typeof def === "string" ? def : "") || /(Html|^html)$/.test(key)) return "html";
    if (/(metaDescription|description|answer|Text|^text)$/.test(key) || (value || "").length > 90 || /\n/.test(value || "")) return "textarea";
    return "text";
  }
  const decodeEntities = (s) => { const t = document.createElement("textarea"); t.innerHTML = s; return t.value; };
  const encodeEntities = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight + 2, 480) + "px";
  }

  const QUILL_TITLES = {
    ".ql-bold": "Fett", ".ql-italic": "Kursiv", ".ql-underline": "Unterstrichen", ".ql-header[value='2']": "Überschrift (groß)",
    ".ql-header[value='3']": "Überschrift (klein)", ".ql-list[value='ordered']": "Nummerierte Liste", ".ql-list[value='bullet']": "Aufzählung",
    ".ql-blockquote": "Zitat", ".ql-link": "Link einfügen", ".ql-clean": "Formatierung entfernen",
  };
  let quillSeq = 0;
  /** E-Mail- und Telefon-Links sollen nicht in neuem Tab öffnen (Quill setzt target/rel bei allen Links). */
  function tidyLinks(html) {
    if (!/href="(mailto|tel):/.test(html)) return html;
    const doc = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
    doc.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]').forEach((a) => { a.removeAttribute("target"); a.removeAttribute("rel"); });
    return doc.body.innerHTML;
  }
  function buildRich(ctrl, obj, key, label, changed) {
    if (typeof Quill === "undefined") {
      const ta = h("textarea", { class: "input mono", rows: 6, "aria-label": label });
      ta.value = obj[key] || "";
      ta.addEventListener("input", () => { obj[key] = ta.value; changed(); });
      ctrl.appendChild(ta);
      return;
    }
    const host = h("div", { class: "quill-host", id: "quill-" + (++quillSeq) });
    const src = h("textarea", { class: "input mono", rows: 8, hidden: true, "aria-label": label + " (HTML-Quelltext)", spellcheck: "false" });
    const toggle = h("button", { type: "button", class: "btn-link", "aria-pressed": "false" }, icon("code"), " HTML-Quelltext");
    ctrl.appendChild(host);
    ctrl.appendChild(src);
    ctrl.appendChild(h("div", { class: "rich-tools" }, toggle));
    const quill = new Quill(host, {
      theme: "snow",
      formats: ["bold", "italic", "underline", "header", "list", "blockquote", "link"],
      modules: { toolbar: [["bold", "italic", "underline"], [{ header: 2 }, { header: 3 }], [{ list: "ordered" }, { list: "bullet" }], ["blockquote", "link"], ["clean"]] },
    });
    quill.clipboard.dangerouslyPasteHTML(obj[key] || "", "silent");
    quill.root.setAttribute("aria-label", label);
    const tb = host.previousElementSibling;
    if (tb) Object.keys(QUILL_TITLES).forEach((sel) => tb.querySelectorAll(sel).forEach((b) => { b.title = QUILL_TITLES[sel]; b.setAttribute("aria-label", QUILL_TITLES[sel]); }));
    quill.on("text-change", (delta, old, source) => {
      if (source === "silent") return;
      obj[key] = tidyLinks(quill.getSemanticHTML().replace(/&nbsp;/g, " ").replace(/<p><\/p>/g, "").trim());
      changed();
    });
    src.addEventListener("input", () => { obj[key] = src.value; changed(); autosize(src); });
    toggle.addEventListener("click", () => {
      const on = src.hidden;
      toggle.setAttribute("aria-pressed", String(on));
      if (on) {
        src.value = obj[key] || "";
        src.hidden = false; host.hidden = true; if (tb) tb.hidden = true; autosize(src); src.focus();
      } else {
        quill.clipboard.dangerouslyPasteHTML(obj[key] || "", "silent");
        src.hidden = true; host.hidden = false; if (tb) tb.hidden = false;
      }
    });
  }

  function buildText(ctrl, obj, key, label, changed, kind, entityMode, path) {
    const raw = obj[key] === null || obj[key] === undefined ? "" : String(obj[key]);
    const val = entityMode ? decodeEntities(raw) : raw;
    let el;
    if (kind === "textarea") {
      el = h("textarea", { class: "input", rows: 3, "aria-label": label });
      el.value = val;
      setTimeout(() => autosize(el), 0);
    } else {
      el = h("input", { class: "input", type: "text", "aria-label": label, inputmode: kind === "link" ? "url" : null, autocomplete: "off", spellcheck: kind === "link" ? "false" : null });
      el.value = val;
    }
    const counter = /metaDescription$/.test(key) ? h("div", { class: "field-hint", "aria-live": "off" }) : null;
    const upd = () => { if (counter) { const n = el.value.length; counter.textContent = n + " Zeichen (Suchmaschinen zeigen meist ca. 150–160 an)"; counter.classList.toggle("warn", n > 170); } };
    el.addEventListener("input", () => {
      obj[key] = entityMode ? encodeEntities(el.value) : el.value;
      if (kind === "textarea") autosize(el);
      upd(); changed();
    });
    ctrl.appendChild(el);
    if (counter) { ctrl.appendChild(counter); upd(); }
  }

  /* ================= Bild-Feld ================= */
  const imgSrc = (f) => (f ? "../" + String(f).replace(/^\/+/, "") : "");

  function buildImage(ctrl, obj, key, label, changed, rebuild) {
    const img = obj[key];
    const preview = h("div", { class: "img-preview" });
    function setPreview() {
      clear(preview);
      if (img.file) {
        const i = h("img", { src: imgSrc(img.file), alt: "", loading: "lazy" });
        i.addEventListener("error", () => { clear(preview); preview.appendChild(h("span", { class: "no-preview", text: "Bild nicht gefunden" })); });
        preview.appendChild(i);
      } else preview.appendChild(h("span", { class: "no-preview", text: "Kein Bild" }));
    }
    const pathEl = h("code", { class: "img-path" });
    function setPath() { pathEl.textContent = img.file || "(kein Bild gewählt)"; }
    function apply(m) {
      img.file = m.file;
      if (!img.alt && m.alt) { img.alt = m.alt; altInput.value = m.alt; }
      setPreview(); setPath(); changed();
    }
    const altInput = h("input", { class: "input", type: "text", "aria-label": "Alt-Text zu " + label, placeholder: "Kurze Beschreibung des Bildes", maxlength: "300", autocomplete: "off" });
    altInput.value = img.alt || "";
    altInput.addEventListener("input", () => { img.alt = altInput.value; changed(); });

    const fileInput = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!f) return;
      try {
        uploadBtn.disabled = true;
        const res = await G.uploadFiles([f]);
        if (res.length) apply(res[0]);
      } finally { uploadBtn.disabled = false; }
    });
    const uploadBtn = h("button", { type: "button", class: "btn btn-outline btn-small", onclick: () => fileInput.click() }, icon("upload"), "Neues Bild hochladen");
    const pickBtn = h("button", { type: "button", class: "btn btn-outline btn-small", onclick: async () => {
      const r = await G.pickImage({ title: "Bild auswählen: " + label });
      if (r && r.length) apply(r[0]);
    } }, icon("image"), "Aus Bilderliste wählen");
    const clearBtn = h("button", { type: "button", class: "btn btn-outline btn-small", onclick: () => { img.file = ""; setPreview(); setPath(); changed(); } }, icon("x"), "Bild entfernen");
    setPreview(); setPath();
    ctrl.appendChild(h("div", { class: "img-field" }, preview,
      h("div", { class: "img-side" }, pathEl,
        h("div", { class: "btn-row" }, uploadBtn, pickBtn, clearBtn, fileInput),
        h("label", { class: "mini-label" }, "Alt-Text (Bildbeschreibung für Screenreader und Suchmaschinen)", altInput))));
  }

  /* ================= Listen ================= */
  function blankFrom(sample) {
    if (isArr(sample)) return [];
    if (isObj(sample)) {
      if (isImage(sample)) return { file: "", alt: "" };
      const o = {};
      for (const k of Object.keys(sample)) o[k] = blankFrom(sample[k]);
      return o;
    }
    if (typeof sample === "number") return 0;
    if (typeof sample === "boolean") return false;
    return "";
  }
  function richness(v) { return isObj(v) ? Object.keys(v).reduce((n, k) => n + 1 + (isObj(v[k]) ? richness(v[k]) : 0), 0) : 0; }
  function richestSample(arr, defArr) {
    let best = null, bs = -1;
    (arr || []).concat(defArr || []).forEach((it) => { const r = richness(it); if (r > bs) { bs = r; best = it; } });
    return best;
  }
  const PRIMARY = ["title", "name", "question", "label"];
  const SECONDARY = ["role", "teacher", "date", "time", "description"];
  function summaryParts(item, idx) {
    if (!isObj(item)) return { title: G.trunc(String(item), 60) || "Eintrag " + (idx + 1), sub: "", thumb: "" };
    const pick = (keys) => { for (const k of keys) { if (typeof item[k] === "string" && G.plainText(item[k])) return G.trunc(G.plainText(item[k]), 70); } return ""; };
    let thumb = "";
    for (const k of Object.keys(item)) if (isImage(item[k]) && item[k].file) { thumb = item[k].file; break; }
    if (!thumb && typeof item.thumbJpg === "string") thumb = item.thumbJpg;
    const p = pick(PRIMARY), s = pick(SECONDARY);
    return { title: p || s || "Eintrag " + (idx + 1), sub: p ? s : "", thumb };
  }

  const openState = {}; // Listenpfad -> Set(offene Indizes), bleibt über Neuzeichnen erhalten
  G.editorOpenState = openState;

  function buildArray(ctrl, obj, key, path, label, changed, rebuild, ctx) {
    const arr = obj[key];
    const unitPath = ctx.unit || path;
    const open = (openState[path] = openState[path] || new Set());
    const defArr = getAt(S.defaults, path);
    const newestFirst = /\.(posts|documents)$/.test(path);
    const list = h("div", { class: "array-list" });
    // Vereinigung aller Felder der Einträge (auch der Standard-Einträge): so bekommt jeder Eintrag alle Felder
    // (z. B. ein Foto), auch wenn einzelne Einträge sie bisher nicht haben.
    const schemaBlank = {};
    arr.concat(defArr || []).forEach((it) => { if (isObj(it) && !isImage(it)) Object.keys(it).forEach((k) => { if (!(k in schemaBlank)) schemaBlank[k] = blankFrom(it[k]); }); });

    function rerender() { if (rebuild) rebuild(); else { clear(ctrl); buildArray(ctrl, obj, key, path, label, changed, rebuild, ctx); } }

    arr.forEach((item, i) => {
      const parts = summaryParts(item, i);
      const details = h("details", { class: "array-item" });
      const idx = i;
      const move = (d) => (e) => {
        e.preventDefault(); e.stopPropagation();
        const j = idx + d;
        if (j < 0 || j >= arr.length) return;
        [arr[idx], arr[j]] = [arr[j], arr[idx]];
        const wasI = open.has(idx), wasJ = open.has(j);
        open.delete(idx); open.delete(j);
        if (wasI) open.add(j);
        if (wasJ) open.add(idx);
        changed(); rerender();
        const nb = ctrl.querySelector('[data-item="' + j + '"] .move-' + (d < 0 ? "up" : "down"));
        if (nb && !nb.disabled) nb.focus();
      };
      const summary = h("summary", { class: "array-summary", "data-item": i },
        h("span", { class: "chev" }, icon("chevron")),
        h("span", { class: "sum-num", text: String(i + 1) }),
        parts.thumb ? h("img", { class: "sum-thumb", src: imgSrc(parts.thumb), alt: "", loading: "lazy", onerror: function () { this.style.display = "none"; } }) : null,
        h("span", { class: "sum-text" }, h("span", { class: "sum-title", text: parts.title }), parts.sub ? h("span", { class: "sum-sub", text: parts.sub }) : null),
        h("span", { class: "sum-actions" },
          h("button", { type: "button", class: "icon-btn move-up", "aria-label": "Eintrag " + (i + 1) + " nach oben", title: "Nach oben", disabled: i === 0, onclick: move(-1) }, icon("up")),
          h("button", { type: "button", class: "icon-btn move-down", "aria-label": "Eintrag " + (i + 1) + " nach unten", title: "Nach unten", disabled: i === arr.length - 1, onclick: move(1) }, icon("down")),
          h("button", { type: "button", class: "icon-btn danger", "aria-label": "Eintrag " + (i + 1) + " entfernen", title: "Entfernen", onclick: async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!(await G.confirm({ title: "Eintrag entfernen?", text: "„" + parts.title + "“ wird aus der Liste entfernt (erst mit „Speichern“ endgültig).", confirmLabel: "Entfernen", danger: true }))) return;
            arr.splice(idx, 1);
            const shifted = new Set(); open.forEach((n) => { if (n < idx) shifted.add(n); else if (n > idx) shifted.add(n - 1); });
            open.clear(); shifted.forEach((n) => open.add(n));
            changed(); rerender();
          } }, icon("trash"))));
      details.appendChild(summary);
      const body = h("div", { class: "array-body" });
      details.appendChild(body);
      let built = false;
      function buildBody() {
        if (built) return; built = true;
        if (isObj(item)) {
          Object.keys(schemaBlank).forEach((k) => { if (!(k in item)) item[k] = clone(schemaBlank[k]); });
          renderObject(body, item, path + "." + i, { unit: unitPath });
        }
        else {
          const inp = h("input", { class: "input", type: "text", "aria-label": label + " " + (i + 1) });
          inp.value = String(item);
          inp.addEventListener("input", () => { arr[idx] = inp.value; changed(); });
          body.appendChild(inp);
        }
      }
      details.addEventListener("toggle", () => {
        if (details.open) { open.add(idx); buildBody(); } else open.delete(idx);
      });
      if (open.has(i)) { details.open = true; buildBody(); }
      list.appendChild(details);
    });
    if (!arr.length) list.appendChild(h("p", { class: "empty-note", text: "Diese Liste ist leer." }));
    ctrl.appendChild(list);

    const addBtn = h("button", { type: "button", class: "btn btn-primary btn-small", onclick: () => {
      const sample = richestSample(arr, defArr);
      const blank = sample === null || sample === undefined ? "" : blankFrom(sample);
      let at;
      if (newestFirst) { arr.unshift(blank); at = 0; } else { arr.push(blank); at = arr.length - 1; }
      const shifted = new Set(); open.forEach((n) => shifted.add(newestFirst ? n + 1 : n));
      open.clear(); shifted.forEach((n) => open.add(n)); open.add(at);
      changed(); rerender();
      const sm = ctrl.querySelector('[data-item="' + at + '"]');
      if (sm) { sm.scrollIntoView({ block: "center", behavior: "smooth" }); const first = sm.parentElement.querySelector("input,textarea"); if (first) setTimeout(() => first.focus({ preventScroll: true }), 250); }
    } }, icon("plus"), newestFirst ? "Neuen Eintrag oben hinzufügen" : "Eintrag hinzufügen");
    ctrl.appendChild(h("div", { class: "array-add" }, addBtn,
      h("span", { class: "field-hint", text: arr.length + (arr.length === 1 ? " Eintrag" : " Einträge") + ". Listen werden als Ganzes gespeichert." })));
  }

  /* ================= Rekursiver Renderer ================= */
  function renderObject(container, obj, prefix, ctx) {
    ctx = ctx || { unit: null };
    let group = null, groupKey = null;
    const keys = Object.keys(obj);
    if (prefix === "site") keys.sort((a, b) => Object.keys(SITE_GROUP).indexOf(a) - Object.keys(SITE_GROUP).indexOf(b));
    const grouping = !ctx.unit;
    keys.forEach((key) => {
      const v = obj[key];
      const path = prefix + "." + key;
      const c = cls(v);
      let host = container;
      if (grouping && c !== "array" && c !== "object") {
        const gid = groupId(prefix, key);
        if (gid !== groupKey) {
          group = h("section", { class: "card group" }, h("h3", { class: "group-title", text: groupTitle(gid) }));
          container.appendChild(group);
          groupKey = gid;
        }
        host = group;
      } else groupKey = null;
      renderField(host, obj, key, path, ctx, host !== container);
    });
  }

  function renderField(container, obj, key, path, ctx, inGroup) {
    const v = obj[key];
    let label = labelFor(key, path);
    if (inGroup) { const m = label.match(/^([^:0-9]+): (.+)$/); if (m) label = m[2].charAt(0).toUpperCase() + m[2].slice(1); }
    const c = cls(v);
    if (c === "array") {
      if (ctx.unit) {
        container.appendChild(h("div", { class: "subhead", text: label }));
        const sub = h("div");
        container.appendChild(sub);
        buildArray(sub, obj, key, path, label, () => touch(ctx.unit), null, ctx);
      } else {
        const wrap = h("section", { class: "card group array-card" });
        container.appendChild(wrap);
        unitField(wrap, { path, label, extraClass: "array-field", build: (ctrl, changed, rebuild) => buildArray(ctrl, obj, key, path, label, changed, rebuild, ctx) });
      }
      return;
    }
    if (c === "image") {
      field(container, ctx, { path, label, build: (ctrl, changed, rebuild) => buildImage(ctrl, obj, key, label, changed, rebuild) });
      return;
    }
    if (c === "object") {
      const sec = h("section", { class: "card group" }, h("h3", { class: "group-title", text: label }));
      container.appendChild(sec);
      renderObject(sec, v, path, ctx);
      return;
    }
    if (c === "boolean") {
      field(container, ctx, { path, label, build: (ctrl, changed) => {
        const cb = h("input", { type: "checkbox", id: "cb-" + path, checked: !!v });
        cb.addEventListener("change", () => { obj[key] = cb.checked; changed(); });
        ctrl.appendChild(h("label", { class: "check", for: "cb-" + path }, cb, " Ja"));
      } });
      return;
    }
    if (c === "number") {
      field(container, ctx, { path, label, build: (ctrl, changed) => {
        const inp = h("input", { class: "input", type: "number", "aria-label": label });
        inp.value = v;
        inp.addEventListener("input", () => { obj[key] = inp.value === "" ? 0 : Number(inp.value); changed(); });
        ctrl.appendChild(inp);
      } });
      return;
    }
    // Text
    const def = ctx.unit ? undefined : getAt(S.defaults, path);
    const kind = stringKind(key, v, def);
    const entityMode = !ctx.unit && typeof def === "string" && ENTITY_RE.test(def) && kind !== "html";
    field(container, ctx, { path, label, build: (ctrl, changed) => {
      if (kind === "html") buildRich(ctrl, obj, key, label, changed);
      else buildText(ctrl, obj, key, label, changed, kind, entityMode, path);
    } });
  }

  /* ================= Seiten-Ansicht ================= */
  function renderPage(container, key) {
    resetRegistry();
    const prefix = key === "site" ? "site" : "pages." + key;
    const obj = getAt(S.draft, prefix);
    const title = pageLabel(key);
    const changed = pageChangedCount(key);
    const head = h("div", { class: "page-head" },
      h("div", null, h("h1", { text: title }), h("p", { class: "lead", text: key === "site" ? "Angaben, die auf mehreren Seiten der Website erscheinen." : "Alle Texte und Bilder dieser Seite." })),
      h("div", { class: "btn-row" },
        h("a", { class: "btn btn-outline btn-small", href: "../" + pageFile(key), target: "_blank", rel: "noopener" }, icon("external"), "Seite ansehen"),
        h("button", { type: "button", class: "btn btn-outline btn-small", id: "pageResetBtn", disabled: changed === 0, onclick: async () => {
          const n = unitsUnder(key).filter((u) => !eqDefault(u));
          if (!n.length) return;
          if (!(await G.confirm({ title: "Ganze Seite auf Standard zurücksetzen?", text: "Alle " + n.length + " geänderten Felder dieser Seite werden auf den ausgelieferten Standard zurückgesetzt. Erst mit „Speichern“ wird das übernommen.", confirmLabel: "Zurücksetzen", danger: true }))) return;
          n.forEach((u) => { setAt(S.draft, u, clone(getAt(S.defaults, u))); touch(u); });
          G.rerender();
        } }, icon("undo"), "Seite auf Standard")));
    container.appendChild(head);
    if (key === "galerie") {
      container.appendChild(h("div", { class: "notice info" }, "Die Fotos der Galerie verwalten Sie unter ", h("a", { href: "#/galerie", text: "Bilder & Medien › Galerie" }), "."));
    }
    if (!obj) { container.appendChild(h("p", { text: "Für diesen Bereich sind keine Inhalte vorhanden." })); return; }
    renderObject(container, obj, prefix, { unit: null });
  }

  /* ================= Galerie (Pseudo-Wurzel gallery.items) ================= */
  function galleryUnitField(container, build) {
    unitField(container, { path: "gallery.items", label: "Galerie-Bilder", extraClass: "gallery-field", build });
  }

  Object.assign(G, {
    editor: { S, loadContent, computePatch, save, discard, touch, register, resetRegistry, renderPage, pageKeys, pageLabel, pageChangedCount, pathLabel, labelFor, unitField, galleryUnitField, eqDefault, getAt, setAt, canon, blankFrom, richestSample, cls, isImage, imgSrc, unitsUnder },
  });
})(window.GSA);
