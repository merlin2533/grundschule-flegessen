// Bildvarianten erzeugen (wird von build.js vor bake-content.js aufgerufen):
//   node tools/images.js
// - assets/images/{site,pages,team,klassen}/*.jpg -> -400w/-800w/-1200w (nur kleiner als das Original) + .webp
// - Team-Porträts: nur -400w; Logo: logo-96.jpg/.webp
// - Galerie (content/gallery-public.json): <slug>-960w.jpg/.webp, Felder mid/w/h im JSON
// - schreibt tools/image-meta.json (+ minifizierte Kopie content/image-meta.json)
// Neu erzeugt wird nur, wenn das Original neuer ist als die Ausgabe. Originale bleiben unangetastet.
// Eine .webp, die nicht kleiner als ihre .jpg ist, wird gelöscht (.htaccess liefert .webp nur, wenn vorhanden).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const IMG = 'assets/images';
const Q = 74;
const WIDTHS = [400, 800, 1200];
const DIRS = { site: WIDTHS, pages: WIDTHS, klassen: WIDTHS, team: [400] };
const NO_VARIANTS = /^(favicon-|og-image|logo\.)/;
const GENERATED = /-(\d+)w\.jpe?g$|^logo-96\./i;
const p = (rel) => path.join(root, rel);
const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
const size = (f) => fs.statSync(f).size;
const rel = (...parts) => parts.join('/');

async function dims(file) {
  const m = await sharp(file).metadata();
  const swap = m.orientation && m.orientation >= 5;
  return { w: swap ? m.height : m.width, h: swap ? m.width : m.height };
}

// erzeugt out (jpg) aus src in Breite w; gibt true bei Neuerzeugung
async function makeJpg(src, out, w) {
  if (mtime(out) >= mtime(src)) return false;
  await sharp(src).rotate().resize({ width: w, withoutEnlargement: true }).jpeg({ quality: Q, mozjpeg: true }).toFile(out);
  return true;
}

// .webp neben jpg sicherstellen; nicht kleinere .webp entfernen
// tools/image-nowebp.json merkt sich verworfene .webp (Schlüssel = jpg, Wert = mtime der jpg), damit sie nicht bei jedem Lauf neu gerechnet werden
const nowebpPath = p('tools/image-nowebp.json');
const nowebp = fs.existsSync(nowebpPath) ? JSON.parse(fs.readFileSync(nowebpPath, 'utf8')) : {};
const nowebpBefore = JSON.stringify(nowebp);
async function ensureWebp(jpgAbs, force) {
  const jpg = jpgAbs, key = path.relative(root, jpg).split(path.sep).join('/');
  const webp = jpg.replace(/\.jpe?g$/i, '.webp');
  if (!force && !fs.existsSync(webp) && nowebp[key] && nowebp[key] >= mtime(jpg)) return;
  if (force || mtime(webp) < mtime(jpg)) await sharp(jpg).rotate().webp({ quality: Q }).toFile(webp + '.tmp').then(() => fs.renameSync(webp + '.tmp', webp));
  if (fs.existsSync(webp) && size(webp) >= size(jpg)) { fs.unlinkSync(webp); nowebp[key] = mtime(jpg); } else delete nowebp[key];
}

async function variantsFor(srcRel, widths, meta) {
  const src = p(srcRel);
  const { w, h } = await dims(src);
  const base = srcRel.replace(/\.jpe?g$/i, '');
  const variants = [];
  for (const vw of widths) {
    if (vw >= w) continue;
    const outRel = base + '-' + vw + 'w.jpg';
    const made = await makeJpg(src, p(outRel), vw);
    await ensureWebp(p(outRel), made);
    variants.push({ w: vw, file: outRel });
  }
  await ensureWebp(src, false);
  meta[srcRel] = { w, h, variants };
}

async function run() {
  const meta = {};
  let count = 0;
  for (const [dir, widths] of Object.entries(DIRS)) {
    const abs = p(rel(IMG, dir));
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) {
      if (!/\.jpe?g$/i.test(f) || GENERATED.test(f)) continue;
      const srcRel = rel(IMG, dir, f);
      if (f === 'logo.jpg') {
        const out = rel(IMG, dir, 'logo-96.jpg');
        const made = await makeJpg(p(srcRel), p(out), 96);
        await ensureWebp(p(out), made);
        await ensureWebp(p(srcRel), false);
        const d = await dims(p(srcRel));
        meta[srcRel] = { w: d.w, h: d.h, variants: [{ w: 96, file: out }] };
      } else if (NO_VARIANTS.test(f)) {
        const d = await dims(p(srcRel));
        meta[srcRel] = { w: d.w, h: d.h, variants: [] };
        await ensureWebp(p(srcRel), false);
      } else {
        await variantsFor(srcRel, widths, meta);
      }
      count++;
    }
  }

  // Galerie
  const galPath = p('content/gallery-public.json');
  if (fs.existsSync(galPath)) {
    const before = fs.readFileSync(galPath, 'utf8');
    const items = JSON.parse(before);
    for (const it of items) {
      if (!it.jpg || !fs.existsSync(p(it.jpg))) continue;
      const { w, h } = await dims(p(it.jpg));
      let mid = it.jpg;
      const variants = [];
      if (w > 960) {
        mid = it.jpg.replace(/\.jpe?g$/i, '') + '-960w.jpg';
        const made = await makeJpg(p(it.jpg), p(mid), 960);
        await ensureWebp(p(mid), made);
        variants.push({ w: 960, file: mid });
      }
      await ensureWebp(p(it.jpg), false);
      it.mid = mid; it.w = w; it.h = h;
      meta[it.jpg] = { w, h, variants };
      if (it.thumbJpg && fs.existsSync(p(it.thumbJpg))) {
        const t = await dims(p(it.thumbJpg));
        meta[it.thumbJpg] = { w: t.w, h: t.h, variants: [] };
        await ensureWebp(p(it.thumbJpg), false);
      }
      count++;
    }
    const after = JSON.stringify(items, null, 2) + '\n';
    if (after !== before) fs.writeFileSync(galPath, after);
  }

  const sorted = Object.fromEntries(Object.keys(meta).sort().map((k) => [k, meta[k]]));
  const pretty = JSON.stringify(sorted, null, 1) + '\n';
  const metaPath = p('tools/image-meta.json');
  if (!fs.existsSync(metaPath) || fs.readFileSync(metaPath, 'utf8') !== pretty) fs.writeFileSync(metaPath, pretty);
  const mini = JSON.stringify(sorted);
  const miniPath = p('content/image-meta.json');
  if (!fs.existsSync(miniPath) || fs.readFileSync(miniPath, 'utf8') !== mini) fs.writeFileSync(miniPath, mini);
  const sortedNo = Object.fromEntries(Object.keys(nowebp).sort().map((k) => [k, nowebp[k]]));
  if (JSON.stringify(sortedNo) !== nowebpBefore) fs.writeFileSync(nowebpPath, JSON.stringify(sortedNo, null, 1) + '\n');
  console.log('Bilder geprüft:', count, '| Meta-Einträge:', Object.keys(sorted).length);
}

run().catch((e) => { console.error(e); process.exit(1); });
