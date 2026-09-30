// Gemeinsame Helfer für <img>-Tags (bake-content.js, enhance.js)
const fs = require('fs');
const path = require('path');

function loadMeta() {
  const f = path.join(__dirname, 'image-meta.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function getAttr(tag, name) {
  const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"'));
  return m ? m[1] : null;
}
function setAttr(tag, name, value) {
  const re = new RegExp('\\s' + name + '="[^"]*"');
  const attr = ' ' + name + '="' + esc(value) + '"';
  if (re.test(tag)) return tag.replace(re, () => attr);
  return tag.replace(/\s*\/?>$/, (end) => attr + end.replace(/^\s*/, ''));
}
function removeAttr(tag, name) {
  return tag.replace(new RegExp('\\s' + name + '(?:="[^"]*")?(?=[\\s/>])'), '');
}

// srcset aus Varianten + Original (Breite = meta.w)
function srcsetFor(file, meta) {
  const m = meta[file];
  if (!m || !m.variants || !m.variants.length) return null;
  const parts = m.variants.slice().sort((a, b) => a.w - b.w).map((v) => v.file + ' ' + v.w + 'w');
  parts.push(file + ' ' + m.w + 'w');
  return parts.join(', ');
}

module.exports = { loadMeta, esc, getAttr, setAttr, removeAttr, srcsetFor };
