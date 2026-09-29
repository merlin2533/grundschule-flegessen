"use strict";
/* ==========================================================================
   Grundschule Flegessen — Admin-Panel Logik
   Läuft vollständig im Browser. Es werden keinerlei Daten an einen Server
   gesendet (Quill.js liegt lokal in admin/vendor).
   ========================================================================== */

/* --------------------------------------------------------------------
   1) PASSWORTSCHUTZ (nur Basisschutz, siehe Hinweis in der Oberfläche)
   -------------------------------------------------------------------- */

// SHA-256-Hash des Standardpassworts "flegessen2026".
// Um das Passwort zu ändern: neuen Hash in der Browser-Konsole erzeugen mit
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('NEUES_PASSWORT'))
//     .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
// und den Wert unten eintragen.
const PASSWORD_HASH_HEX = "b3317983fb8bef1134ef98e0d73bdf16321dcc9b3ed18c5bd48fdf941f4fbe98";
const SESSION_FLAG = "gsflegessen_admin_unlocked";

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function showLogin() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appRoot").classList.add("hidden");
}

function unlockApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("hidden");
}

document.getElementById("loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = document.getElementById("passwordInput");
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  const hash = await sha256Hex(input.value);
  if (hash === PASSWORD_HASH_HEX) {
    try { sessionStorage.setItem(SESSION_FLAG, "1"); } catch (e) { /* ignore (private mode) */ }
    unlockApp();
  } else {
    errEl.textContent = "Falsches Passwort. Bitte erneut versuchen.";
    input.value = "";
    input.focus();
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  try { sessionStorage.removeItem(SESSION_FLAG); } catch (e) { /* ignore */ }
  location.reload();
});

// Secure-context / API availability hint
(function secureContextCheck() {
  const warnEl = document.getElementById("secureContextWarning");
  const isChromiumLike = /Chrome|Edg\//.test(navigator.userAgent) && !/Firefox|OPR\//.test(navigator.userAgent);
  if (!window.isSecureContext && typeof window.showDirectoryPicker !== "function" && isChromiumLike) {
    warnEl.textContent = "Hinweis: Ihr Browser unterstützt den Vollmodus grundsätzlich, aber diese Seite läuft nicht in einem " +
      "sicheren Kontext (https:// oder http://localhost). Rufen Sie die Seite über einen lokalen Webserver oder per HTTPS " +
      "auf, damit „Projektordner öffnen“ funktioniert. Der Download-Modus funktioniert trotzdem.";
    warnEl.classList.remove("hidden");
  }
})();

// Skip login if already unlocked this tab-session
try {
  if (sessionStorage.getItem(SESSION_FLAG) === "1") {
    unlockApp();
  } else {
    showLogin();
  }
} catch (e) {
  showLogin();
}

/* --------------------------------------------------------------------
   2) APP-STATE
   -------------------------------------------------------------------- */

let contentData = null;          // parsed content.json (single source of truth)
let mode = null;                 // 'full' | 'download'
let rootDirHandle = null;        // FileSystemDirectoryHandle (full mode only)
let activeTabKey = null;         // 'site' or a pages.<key>
let pendingImages = {};          // path -> File (new image chosen, not yet saved)
let lastSavedAt = null;

const PAGE_LABELS = {
  home: "Startseite",
  "unsere-schule": "Unsere Schule",
  team: "Team",
  klassen: "Klassen",
  schulalltag: "Schulalltag",
  unterrichtszeiten: "Unterrichtszeiten",
  eltern: "Eltern & Einschulung",
  mitteilungen: "Mitteilungen",
  aktuelles: "Aktuelles",
  galerie: "Galerie",
  kontakt: "Kontakt",
  impressum: "Impressum",
  datenschutz: "Datenschutz"
};

const PAGE_HTML_FILES = {
  home: "../index.html",
  "unsere-schule": "../unsere-schule.html",
  team: "../team.html",
  klassen: "../klassen.html",
  schulalltag: "../schulalltag.html",
  unterrichtszeiten: "../unterrichtszeiten.html",
  eltern: "../eltern.html",
  mitteilungen: "../mitteilungen.html",
  aktuelles: "../aktuelles.html",
  galerie: "../galerie.html",
  kontakt: "../kontakt.html",
  impressum: "../impressum.html",
  datenschutz: "../datenschutz.html"
};

function toast(message, isError) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", !!isError);
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3600);
}

function markDirty() {
  document.getElementById("saveBarStatus").textContent = "Es gibt ungespeicherte Änderungen.";
}

function markSaved() {
  lastSavedAt = new Date();
  const hh = String(lastSavedAt.getHours()).padStart(2, "0");
  const mm = String(lastSavedAt.getMinutes()).padStart(2, "0");
  const label = `Zuletzt gespeichert: ${hh}:${mm} Uhr`;
  document.getElementById("saveStatus").textContent = label;
  document.getElementById("saveBarStatus").textContent = label;
}

/* --------------------------------------------------------------------
   3) PROJEKT ÖFFNEN (Vollmodus via File System Access API)
   -------------------------------------------------------------------- */

const hasDirectoryPicker = typeof window.showDirectoryPicker === "function";

if (!hasDirectoryPicker) {
  document.getElementById("fullModeOption").innerHTML =
    "<p><strong>Vollmodus:</strong> In diesem Browser nicht verfügbar (nur Chrome/Edge auf dem Desktop). " +
    "Bitte nutzen Sie den Download-Modus unten.</p>";
}

document.getElementById("openFolderBtn").addEventListener("click", async () => {
  if (!hasDirectoryPicker) return;
  try {
    const dirHandle = await window.showDirectoryPicker();
    let contentDirHandle, fileHandle, file, text, data;
    try {
      contentDirHandle = await dirHandle.getDirectoryHandle("content");
      fileHandle = await contentDirHandle.getFileHandle("content.json");
      file = await fileHandle.getFile();
      text = await file.text();
      data = JSON.parse(text);
    } catch (innerErr) {
      toast("In diesem Ordner wurde keine gültige Datei content/content.json gefunden. Bitte wählen Sie den obersten Ordner der Website aus.", true);
      return;
    }
    rootDirHandle = dirHandle;
    contentData = data;
    mode = "full";
    pendingImages = {};
    startEditor();
  } catch (err) {
    if (err && err.name === "AbortError") return; // user cancelled picker
    console.error(err);
    toast("Der Ordner konnte nicht geöffnet werden: " + (err && err.message ? err.message : err), true);
  }
});

document.getElementById("jsonFileInput").addEventListener("change", async (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    contentData = JSON.parse(text);
  } catch (err) {
    toast("Die Datei konnte nicht als JSON gelesen werden: " + err.message, true);
    return;
  }
  rootDirHandle = null;
  mode = "download";
  pendingImages = {};
  startEditor();
});

/* --------------------------------------------------------------------
   4) EDITOR START / TABS
   -------------------------------------------------------------------- */

function startEditor() {
  document.getElementById("startScreen").classList.add("hidden");
  document.getElementById("editorShell").classList.remove("hidden");
  document.getElementById("saveBar").classList.remove("hidden");

  const badge = document.getElementById("modeBadge");
  badge.classList.remove("hidden", "full", "download");
  if (mode === "full") {
    badge.classList.add("full");
    badge.textContent = "Vollmodus: Änderungen werden direkt gespeichert";
  } else {
    badge.classList.add("download");
    badge.textContent = "Download-Modus: Änderungen werden zum Herunterladen bereitgestellt";
  }

  renderTabs();
  const firstKey = "site";
  selectTab(firstKey);
}

function renderTabs() {
  const nav = document.getElementById("tabNav");
  nav.innerHTML = "";

  const siteBtn = document.createElement("button");
  siteBtn.type = "button";
  siteBtn.textContent = "Allgemein (Website)";
  siteBtn.dataset.tabKey = "site";
  siteBtn.addEventListener("click", () => selectTab("site"));
  nav.appendChild(siteBtn);

  Object.keys(contentData.pages || {}).forEach((pageKey) => {
    const pageObj = contentData.pages[pageKey];
    const label = (pageObj && typeof pageObj.pageTitle === "string" && pageObj.pageTitle.trim())
      ? pageObj.pageTitle
      : (PAGE_LABELS[pageKey] || pageKey);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.dataset.tabKey = pageKey;
    btn.addEventListener("click", () => selectTab(pageKey));
    nav.appendChild(btn);
  });
}

function updateActiveTabStyles() {
  document.querySelectorAll("#tabNav button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tabKey === activeTabKey);
  });
}

function selectTab(key) {
  activeTabKey = key;
  updateActiveTabStyles();
  renderActivePage();
}

/* --------------------------------------------------------------------
   5) GENERISCHER FORMULAR-RENDERER
   -------------------------------------------------------------------- */

function isProbablyRichText(key, value) {
  if (typeof value !== "string") return false;
  if (/<p[ >]|<ul[ >]|<ol[ >]|<li[ >]|<h2[ >]|<h3[ >]/i.test(value)) return true;
  if (/Html$|Text$/.test(key) && value.length > 40) return true;
  return false;
}

function isImageObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "file") &&
    Object.prototype.hasOwnProperty.call(value, "alt");
}

function humanizeKey(key) {
  // Turn camelCase / kebab-case keys into a readable label as a fallback.
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function renderActivePage() {
  const container = document.getElementById("pageContent");
  container.innerHTML = "";

  let dataObj, pathPrefix, previewHref;
  if (activeTabKey === "site") {
    dataObj = contentData.site;
    pathPrefix = "site";
    previewHref = PAGE_HTML_FILES.home;
  } else {
    dataObj = contentData.pages[activeTabKey];
    pathPrefix = "pages." + activeTabKey;
    previewHref = PAGE_HTML_FILES[activeTabKey] || null;
  }

  const header = document.createElement("div");
  header.className = "page-content-header";
  const h2 = document.createElement("h2");
  h2.textContent = activeTabKey === "site" ? "Allgemeine Website-Angaben" :
    (PAGE_LABELS[activeTabKey] || activeTabKey);
  header.appendChild(h2);
  if (previewHref) {
    const a = document.createElement("a");
    a.href = previewHref;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "btn btn-outline btn-small";
    a.textContent = "🔗 Vorschau öffnen";
    header.appendChild(a);
  }
  container.appendChild(header);

  const note = document.createElement("p");
  note.style.color = "var(--color-muted)";
  note.style.fontSize = "0.85rem";
  note.textContent = "Hinweis: Die Vorschau zeigt die aktuell veröffentlichte Seite. Erst nach dem Speichern " +
    "und Hochladen der Datei content.json (bzw. der Bilder) erscheinen Ihre Änderungen dort.";
  container.appendChild(note);

  if (!dataObj || typeof dataObj !== "object") {
    const p = document.createElement("p");
    p.textContent = "Für diesen Bereich sind keine Inhalte vorhanden.";
    container.appendChild(p);
    return;
  }

  renderObjectFields(container, dataObj, pathPrefix);
}

/**
 * Recursively renders form fields for every key in `obj`, mutating `obj`
 * directly on user input so that `contentData` always reflects the current
 * editor state.
 */
function renderObjectFields(container, obj, pathPrefix) {
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    const path = pathPrefix + "." + key;

    if (Array.isArray(value)) {
      renderArrayField(container, obj, key, path);
      return;
    }

    if (isImageObject(value)) {
      renderImageField(container, obj, key, path);
      return;
    }

    if (value !== null && typeof value === "object") {
      // Generic nested object (not currently present in content.json, but
      // handled gracefully so the admin keeps working if the shape grows).
      const wrap = document.createElement("div");
      wrap.className = "nested-object-field";
      const label = document.createElement("div");
      label.className = "field-label";
      label.textContent = humanizeKey(key);
      wrap.appendChild(label);
      renderObjectFields(wrap, value, path);
      container.appendChild(wrap);
      return;
    }

    if (typeof value === "string" && isProbablyRichText(key, value)) {
      renderRichTextField(container, obj, key, path);
      return;
    }

    if (typeof value === "boolean") {
      renderBooleanField(container, obj, key, path);
      return;
    }

    if (typeof value === "number") {
      renderScalarField(container, obj, key, path, "number");
      return;
    }

    // Default: plain string (or null/undefined) -> simple text input
    renderScalarField(container, obj, key, path, "text");
  });
}

function fieldBlockWithLabel(key, path) {
  const wrap = document.createElement("div");
  wrap.className = "field-block";
  const label = document.createElement("label");
  label.textContent = humanizeKey(key);
  const hint = document.createElement("span");
  hint.className = "field-key-hint";
  hint.textContent = path;
  label.appendChild(hint);
  wrap.appendChild(label);
  return wrap;
}

function renderScalarField(container, obj, key, path, inputType) {
  const wrap = fieldBlockWithLabel(key, path);
  const input = document.createElement("input");
  input.type = inputType === "number" ? "number" : "text";
  input.value = (obj[key] === null || obj[key] === undefined) ? "" : String(obj[key]);
  input.addEventListener("input", () => {
    obj[key] = inputType === "number" ? (input.value === "" ? "" : Number(input.value)) : input.value;
    markDirty();
  });
  wrap.appendChild(input);
  container.appendChild(wrap);
}

function renderBooleanField(container, obj, key, path) {
  const wrap = fieldBlockWithLabel(key, path);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!obj[key];
  input.addEventListener("change", () => {
    obj[key] = input.checked;
    markDirty();
  });
  wrap.appendChild(input);
  container.appendChild(wrap);
}

let quillInstanceCounter = 0;

function renderRichTextField(container, obj, key, path) {
  const wrap = fieldBlockWithLabel(key, path);
  wrap.classList.add("richtext-field");
  const editorHost = document.createElement("div");
  const editorId = "quill-editor-" + (quillInstanceCounter++);
  editorHost.id = editorId;
  wrap.appendChild(editorHost);
  container.appendChild(wrap);

  const quill = new Quill("#" + editorId, {
    theme: "snow",
    modules: {
      toolbar: [
        ["bold", "italic"],
        [{ header: 2 }, { header: 3 }],
        [{ list: "ordered" }, { list: "bullet" }],
        ["link"],
        ["clean"]
      ]
    }
  });
  quill.root.innerHTML = obj[key] || "";
  quill.on("text-change", () => {
    obj[key] = quill.root.innerHTML;
    markDirty();
  });
}

function resolvePublicImageSrc(relFilePath) {
  // admin/index.html lives one folder below the site root, so a plain
  // relative path (as stored in content.json) needs a "../" prefix.
  if (!relFilePath) return "";
  return "../" + relFilePath.replace(/^\/+/, "");
}

function renderImageField(container, obj, key, path) {
  const wrap = fieldBlockWithLabel(key, path);
  const row = document.createElement("div");
  row.className = "image-field-row";

  const previewWrap = document.createElement("div");
  previewWrap.className = "image-preview-wrap";
  const img = document.createElement("img");
  img.alt = obj[key].alt || "";
  img.src = resolvePublicImageSrc(obj[key].file);
  img.addEventListener("error", () => {
    img.replaceWith(noPreviewEl());
  });
  previewWrap.appendChild(img);

  function noPreviewEl() {
    const d = document.createElement("div");
    d.className = "no-preview";
    d.textContent = "Keine Vorschau verfügbar";
    return d;
  }

  const controls = document.createElement("div");
  controls.className = "image-field-controls";

  const pathLabel = document.createElement("div");
  pathLabel.className = "image-path-label";
  pathLabel.textContent = obj[key].file || "(kein Pfad)";
  controls.appendChild(pathLabel);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  controls.appendChild(fileInput);

  const targetNote = document.createElement("div");
  targetNote.className = "image-target-note hidden";
  controls.appendChild(targetNote);

  const altLabel = document.createElement("label");
  altLabel.className = "image-alt-label";
  altLabel.textContent = "Alt-Text (Bildbeschreibung)";
  controls.appendChild(altLabel);
  const altInput = document.createElement("input");
  altInput.type = "text";
  altInput.value = obj[key].alt || "";
  altInput.addEventListener("input", () => {
    obj[key].alt = altInput.value;
    markDirty();
  });
  controls.appendChild(altInput);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const targetPath = obj[key].file;
    pendingImages[path] = file;
    markDirty();

    // Update preview immediately
    const objectUrl = URL.createObjectURL(file);
    const previewImg = previewWrap.querySelector("img") || (() => {
      previewWrap.innerHTML = "";
      const i = document.createElement("img");
      previewWrap.appendChild(i);
      return i;
    })();
    previewImg.src = objectUrl;

    if (mode === "download") {
      const filename = (targetPath || file.name).split("/").pop();
      triggerFileDownload(file, filename);
      targetNote.textContent = `Diese Datei wurde zum Herunterladen angeboten. Speichern Sie sie als: ${targetPath || filename}`;
      targetNote.classList.remove("hidden");
    } else {
      targetNote.textContent = `Wird beim Speichern abgelegt unter: ${targetPath}`;
      targetNote.classList.remove("hidden");
    }
  });

  row.appendChild(previewWrap);
  row.appendChild(controls);
  wrap.appendChild(row);
  container.appendChild(wrap);
}

function cloneBlankFromShape(sample) {
  if (Array.isArray(sample)) return [];
  if (sample && typeof sample === "object") {
    const out = {};
    Object.keys(sample).forEach((k) => {
      const v = sample[k];
      if (v && typeof v === "object" && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, "file") && Object.prototype.hasOwnProperty.call(v, "alt")) {
        out[k] = { file: "", alt: "" };
      } else if (Array.isArray(v)) {
        out[k] = [];
      } else if (typeof v === "object" && v !== null) {
        out[k] = cloneBlankFromShape(v);
      } else if (typeof v === "number") {
        out[k] = 0;
      } else if (typeof v === "boolean") {
        out[k] = false;
      } else {
        out[k] = "";
      }
    });
    return out;
  }
  return "";
}

function itemSummaryLabel(item, index) {
  if (item && typeof item === "object") {
    const candidateKeys = ["name", "title", "question", "label", "date"];
    for (const k of candidateKeys) {
      if (typeof item[k] === "string" && item[k].trim()) return item[k];
    }
  }
  return "Eintrag " + (index + 1);
}

function renderArrayField(container, obj, key, path) {
  const wrap = document.createElement("div");
  wrap.className = "array-field";
  const label = document.createElement("div");
  label.className = "field-label";
  label.textContent = humanizeKey(key) + " (Liste)";
  wrap.appendChild(label);

  const arr = obj[key];

  arr.forEach((item, index) => {
    const details = document.createElement("details");
    details.className = "array-item-card";
    const summary = document.createElement("summary");
    summary.textContent = itemSummaryLabel(item, index);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "array-item-body";

    if (item && typeof item === "object" && !Array.isArray(item)) {
      renderObjectFields(body, item, path + "." + index);
    } else {
      // array of plain scalars, rendered inline for safety
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(item);
      input.addEventListener("input", () => {
        arr[index] = input.value;
        markDirty();
      });
      body.appendChild(input);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-danger btn-small array-item-remove";
    removeBtn.textContent = "🗑 Eintrag entfernen";
    removeBtn.addEventListener("click", () => {
      if (!confirm("Diesen Eintrag wirklich entfernen?")) return;
      arr.splice(index, 1);
      clearPendingImagesUnder(path);
      markDirty();
      renderActivePage();
    });
    body.appendChild(removeBtn);

    details.appendChild(body);
    wrap.appendChild(details);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-primary btn-small array-add-btn";
  addBtn.textContent = "+ Eintrag hinzufügen";
  addBtn.addEventListener("click", () => {
    const sample = arr.length > 0 ? arr[0] : null;
    const blank = sample !== null ? cloneBlankFromShape(sample) : "";
    arr.push(blank);
    markDirty();
    renderActivePage();
  });
  wrap.appendChild(addBtn);

  container.appendChild(wrap);
}

function clearPendingImagesUnder(pathPrefix) {
  // Array indices shift after add/remove; any in-flight (not yet saved)
  // image selections under this array become unreliable, so drop them.
  // (Limitation: the user needs to re-pick images changed in the same
  // session right before adding/removing another item in the same list.)
  Object.keys(pendingImages).forEach((p) => {
    if (p === pathPrefix || p.startsWith(pathPrefix + ".")) {
      delete pendingImages[p];
    }
  });
}

/* --------------------------------------------------------------------
   6) SPEICHERN
   -------------------------------------------------------------------- */

function triggerFileDownload(blobOrFile, filename) {
  const url = URL.createObjectURL(blobOrFile);
  const a = document.getElementById("downloadHelperLink");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function writeFileIntoDirHandle(rootHandle, relPath, fileBlob) {
  const parts = relPath.split("/").filter(Boolean);
  let dir = rootHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(fileBlob);
  await writable.close();
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  const btn = document.getElementById("saveBtn");
  btn.disabled = true;
  btn.textContent = "Speichere …";
  try {
    if (mode === "full") {
      await saveFullMode();
    } else {
      await saveDownloadMode();
    }
    markSaved();
    toast("Änderungen gespeichert.");
  } catch (err) {
    console.error(err);
    toast("Fehler beim Speichern: " + (err && err.message ? err.message : err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 Speichern";
  }
});

async function saveFullMode() {
  if (!rootDirHandle) throw new Error("Kein Projektordner geöffnet.");

  // 1) Write replacement images first, at their JSON-defined target path.
  for (const [path, file] of Object.entries(pendingImages)) {
    const targetPath = getImageTargetPathForFieldPath(path);
    if (!targetPath) continue;
    await writeFileIntoDirHandle(rootDirHandle, targetPath, file);
  }
  pendingImages = {};

  // 2) Write content.json
  const contentDirHandle = await rootDirHandle.getDirectoryHandle("content", { create: true });
  const fileHandle = await contentDirHandle.getFileHandle("content.json", { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(contentData, null, 2));
  await writable.close();

  // Refresh previews (image bytes changed on disk, and object URLs used for
  // preview so far already reflect the new file — nothing else to do).
}

async function saveDownloadMode() {
  // Images were already offered for download individually at selection time.
  // Here we only need to (re-)offer the updated content.json.
  const json = JSON.stringify(contentData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  triggerFileDownload(blob, "content.json");
  toast("content.json wurde heruntergeladen. Bitte ersetzen Sie damit content/content.json auf Ihrem Server.");
}

/** Given the field path used as key in pendingImages (e.g. "pages.team.members.3.photo"),
 *  resolve the current `file` string stored in contentData at that path. */
function getImageTargetPathForFieldPath(fieldPath) {
  const parts = fieldPath.split(".");
  let cur = contentData;
  for (const part of parts) {
    if (cur === undefined || cur === null) return null;
    const idx = /^\d+$/.test(part) ? Number(part) : part;
    cur = cur[idx];
  }
  if (cur && typeof cur === "object" && typeof cur.file === "string") return cur.file;
  return null;
}

// Warn before leaving with unsaved changes is intentionally omitted to keep
// the tool simple; the sticky status text communicates unsaved state instead.
