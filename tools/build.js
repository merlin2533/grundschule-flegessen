// Build-Schritt: node tools/build.js   (oder: npm run build)
//  1. Inhalte aus content.json fest in die HTML-Seiten schreiben (bake-content.js)
//  2. neue eindeutige Build-ID erzeugen -> version.json
//  3. CSS/JS-Verweise mit ?v=<ID> versehen und version-check.js einbinden
//  4. sitemap.xml neu erzeugen (lastmod ändert sich nur bei geänderten Seiten)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const DOMAIN = 'https://grundschule-flegessen.de';

execFileSync(process.execPath, [path.join(__dirname, 'bake-content.js')], { stdio: 'inherit' });

const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const id = '' + now.getUTCFullYear() + p2(now.getUTCMonth() + 1) + p2(now.getUTCDate()) + '-' +
  p2(now.getUTCHours()) + p2(now.getUTCMinutes()) + p2(now.getUTCSeconds()) + '-' + crypto.randomBytes(3).toString('hex');

fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ id, built: now.toISOString() }, null, 2) + '\n');

// --- HTML: versionierte Assets + version-check.js ---
function version(html, prefix) {
  html = html.replace(/(href|src)="((?:\.\.\/)?(?:css|js|admin)\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"/g, (m, attr, p) => attr + '="' + p + '?v=' + id + '"');
  html = html.replace(/(href|src)="(vendor\/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"/g, (m, attr, p) => attr + '="' + p + '?v=' + id + '"');
  html = html.replace(/(href|src)="(admin\.css|app\.js)(?:\?v=[^"]*)?"/g, (m, attr, p) => attr + '="' + p + '?v=' + id + '"');
  const checkSrc = prefix + 'js/version-check.js?v=' + id;
  if (/js\/version-check\.js/.test(html)) {
    html = html.replace(/src="[^"]*js\/version-check\.js[^"]*"/, 'src="' + checkSrc + '"');
  } else {
    html = html.replace('</head>', '<script src="' + checkSrc + '" defer></script>\n</head>');
  }
  return html;
}

const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
for (const f of pages) {
  const full = path.join(root, f);
  fs.writeFileSync(full, version(fs.readFileSync(full, 'utf8'), ''));
}
const adminIndex = path.join(root, 'admin', 'index.html');
if (fs.existsSync(adminIndex)) fs.writeFileSync(adminIndex, version(fs.readFileSync(adminIndex, 'utf8'), '../'));

// --- sitemap.xml ---
const meta = {
  'index.html': ['weekly', '1.0'], 'unsere-schule.html': ['monthly', '0.9'], 'eltern.html': ['monthly', '0.9'],
  'schulalltag.html': ['monthly', '0.8'], 'aktuelles.html': ['weekly', '0.8'], 'kontakt.html': ['yearly', '0.8'],
  'team.html': ['monthly', '0.7'], 'klassen.html': ['monthly', '0.7'], 'unterrichtszeiten.html': ['monthly', '0.7'],
  'mitteilungen.html': ['weekly', '0.6'], 'galerie.html': ['monthly', '0.5'],
  'impressum.html': ['yearly', '0.2'], 'datenschutz.html': ['yearly', '0.2']
};
const statePath = path.join(root, 'tools', 'sitemap-state.json');
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
const today = now.toISOString().slice(0, 10);
const normalize = (html) => html.replace(/\?v=[0-9a-z-]+/g, '');
const urls = Object.keys(meta).filter((f) => pages.includes(f)).map((f) => {
  const hash = crypto.createHash('sha1').update(normalize(fs.readFileSync(path.join(root, f), 'utf8'))).digest('hex');
  if (!state[f] || state[f].hash !== hash) state[f] = { hash, lastmod: today };
  const loc = DOMAIN + '/' + (f === 'index.html' ? '' : f);
  return '  <url><loc>' + loc + '</loc><lastmod>' + state[f].lastmod + '</lastmod><changefreq>' + meta[f][0] + '</changefreq><priority>' + meta[f][1] + '</priority></url>';
});
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n');

console.log('Build-ID:', id, '| Seiten:', pages.length, '| sitemap.xml:', urls.length, 'URLs');
