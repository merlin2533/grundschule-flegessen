// Schreibt die Inhalte aus content/content.json fest in die HTML-Seiten
// (Texte, Bilder, Listen, Meta-Angaben). Nach jeder Änderung im Admin ausführen:
//   node tools/bake-content.js
// Dadurch sehen auch Suchmaschinen und Besucher ohne JavaScript den aktuellen Stand.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const content = JSON.parse(fs.readFileSync(path.join(root, 'content/content.json'), 'utf8'));

const { loadMeta, setAttr, removeAttr, srcsetFor } = require('./img-util');
const imageMeta = loadMeta();

const ctx = { window: { GSImageMeta: imageMeta }, document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }, fetch() {}, CustomEvent: function () {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/main.js'), 'utf8'), ctx);
const renderers = ctx.window.GSRenderers;

const getPath = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object' && k in a ? a[k] : undefined), o);
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// finds the end of the element whose opening tag ends at `from` (depth-aware)
function closeIndex(html, tag, from) {
  const re = new RegExp('<(/?)' + tag + '(?=[\\s>/])', 'gi');
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

function bake(html) {
  // text + lists
  const openRe = /<(\w+)\b[^>]*?\sdata-edit(-list)?="([^"]+)"[^>]*>/g;
  let out = '', last = 0, m;
  while ((m = openRe.exec(html))) {
    const [open, tag, isList, key] = m;
    if (/\/>$/.test(open)) continue;
    const innerStart = m.index + open.length;
    const end = closeIndex(html, tag, innerStart);
    if (end < 0) continue;
    const val = getPath(content, key);
    let inner = null;
    if (!isList && typeof val === 'string' && val.trim()) inner = val;
    if (isList && Array.isArray(val) && val.length) {
      const tpl = (open.match(/data-list-template="([^"]+)"/) || [])[1];
      if (renderers[tpl]) inner = '\n' + val.map((v, i) => renderers[tpl](v, i)).join('\n') + '\n';
    }
    if (inner === null) continue;
    out += html.slice(last, innerStart) + inner;
    last = end;
    openRe.lastIndex = end;
  }
  html = out + html.slice(last);

  // images
  html = html.replace(/<img\b[^>]*?\sdata-edit-img="([^"]+)"[^>]*>/g, (tagStr, key) => {
    const v = getPath(content, key);
    if (!v || !v.file) return tagStr;
    tagStr = tagStr.replace(/\ssrc="[^"]*"/, ' src="' + escAttr(v.file) + '"');
    if (v.alt) tagStr = tagStr.replace(/\salt="[^"]*"/, ' alt="' + escAttr(v.alt) + '"');
    const m = imageMeta[v.file];
    const srcset = srcsetFor(v.file, imageMeta);
    if (srcset) tagStr = setAttr(tagStr, 'srcset', srcset); else tagStr = removeAttr(tagStr, 'srcset');
    if (m) { tagStr = setAttr(tagStr, 'width', m.w); tagStr = setAttr(tagStr, 'height', m.h); }
    return tagStr;
  });
  return html;
}

const pageKeys = { 'unsere-schule': 'unsere-schule', team: 'team', klassen: 'klassen', schulalltag: 'schulalltag', unterrichtszeiten: 'unterrichtszeiten', eltern: 'eltern', mitteilungen: 'mitteilungen', aktuelles: 'aktuelles', galerie: 'galerie', kontakt: 'kontakt', impressum: 'impressum', datenschutz: 'datenschutz' };

for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.html'))) {
  const full = path.join(root, file);
  const before = fs.readFileSync(full, 'utf8');
  let html = bake(before);
  const page = content.pages[pageKeys[file.replace('.html', '')]];
  if (page && page.metaDescription) {
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, '$1' + escAttr(page.metaDescription) + '$2');
    html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, '$1' + escAttr(page.metaDescription) + '$2');
  }
  if (html !== before) { fs.writeFileSync(full, html); console.log('aktualisiert:', file); }
}
console.log('fertig');
