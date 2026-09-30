// Dev-only Messskript (nicht deployen): node tools/perf.js [--no-webp] [--url=http://host:port] [seite.html ...]
// Misst mobil (375x812, DPR 3, CPU 4x gedrosselt, Slow-4G) je Seite LCP, CLS,
// Bild-Bytes (beim Laden und nach vollständigem Scrollen) und Anzahl Requests.
// Hinweis: `python3 -m http.server` / `php -S` ignorieren .htaccess (kein WebP-Rewrite, keine Cache-Header).
// Der eingebaute Server emuliert deshalb den WebP-Rewrite (Accept: image/webp -> .webp); mit --no-webp aus.
// Benötigt playwright-core (PW_DIR=<Ordner mit node_modules/playwright-core>) und Chromium (PW_CHROMIUM=<Pfad>).
const fs = require('fs');
const path = require('path');
const http = require('http');

const PW_DIR = process.env.PW_DIR || '/tmp/claude-0/-home-user-grundschule-flegessen/2d6668bf-14ef-574e-8bf3-25af573ed38c/scratchpad/pw';
const CHROMIUM = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const { chromium } = require(require.resolve('playwright-core', { paths: [PW_DIR, __dirname] }));

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const noWebp = args.includes('--no-webp');
const urlArg = (args.find((a) => a.startsWith('--url=')) || '').slice(6);
const pages = args.filter((a) => !a.startsWith('--'));
if (!pages.length) pages.push('index.html', 'team.html', 'galerie.html');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      let file = path.join(root, p);
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      if (!noWebp && /\.jpe?g$/i.test(file) && /image\/webp/.test(req.headers.accept || '') && fs.existsSync(file.replace(/\.jpe?g$/i, '.webp'))) file = file.replace(/\.jpe?g$/i, '.webp');
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('404'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Vary': 'Accept' });
        res.end(buf);
      });
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function measure(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  const types = new Map(); let requests = 0, imgBytes = 0;
  cdp.on('Network.requestWillBeSent', (e) => { requests++; types.set(e.requestId, e.type); });
  cdp.on('Network.loadingFinished', (e) => { if (types.get(e.requestId) === 'Image') imgBytes += e.encodedDataLength; });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const lcp = await page.evaluate(() => window.__lcp);
  const imgLoad = imgBytes, reqLoad = requests;
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const cls = await page.evaluate(() => window.__cls);
  await ctx.close();
  return { lcp, cls, imgLoad, imgAll: imgBytes, reqLoad, reqAll: requests };
}

(async () => {
  const srv = urlArg ? null : await serve();
  const base = urlArg || 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: fs.existsSync(CHROMIUM + '/chrome-linux/chrome') ? CHROMIUM + '/chrome-linux/chrome' : CHROMIUM, args: ['--no-sandbox'] });
  console.log('Mobil 375x812@3x, CPU 4x, Slow-4G | WebP-Rewrite: ' + (urlArg ? 'Server der --url' : noWebp ? 'aus' : 'emuliert (.htaccess-Ersatz)'));
  console.log('Seite'.padEnd(20) + 'LCP ms'.padStart(8) + 'CLS'.padStart(8) + 'Bild KB (Load)'.padStart(16) + 'Bild KB (gescrollt)'.padStart(21) + 'Req (Load)'.padStart(12) + 'Req (ges.)'.padStart(12));
  for (const p of pages) {
    const r = await measure(browser, base + p);
    console.log(p.padEnd(20) + String(Math.round(r.lcp)).padStart(8) + r.cls.toFixed(3).padStart(8) + String(Math.round(r.imgLoad / 1024)).padStart(16) + String(Math.round(r.imgAll / 1024)).padStart(21) + String(r.reqLoad).padStart(12) + String(r.reqAll).padStart(12));
  }
  await browser.close();
  if (srv) srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
