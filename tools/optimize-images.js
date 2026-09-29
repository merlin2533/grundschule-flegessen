// One-off build tool: resize/compress all crawled source photos into
// web-ready JPEG + WebP (full + thumb) inside assets/images/gallery.
// Run with: node tools/optimize-images.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = process.env.IMG_SRC || '/tmp/claude-0/-home-user-grundschule-flegessen/2d6668bf-14ef-574e-8bf3-25af573ed38c/scratchpad/site-crawl/downloaded/images';
const OUT = path.join(__dirname, '..', 'assets', 'images', 'gallery');
const MANIFEST_OUT = path.join(__dirname, '..', 'content', 'gallery-manifest.json');

const FULL_WIDTH = 1600;
const THUMB_WIDTH = 480;

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(SRC).filter(f => /\.(jpe?g|png|heic)$/i.test(f));
  console.log(`Found ${files.length} source images`);

  const manifest = [];
  const usedSlugs = new Set();
  let ok = 0, skipped = 0, failed = 0;

  for (const file of files) {
    const srcPath = path.join(SRC, file);
    try {
      const stat = fs.statSync(srcPath);
      if (stat.size < 3000) { skipped++; continue; } // tiny/broken files

      let slug = slugify(file);
      let unique = slug;
      let n = 2;
      while (usedSlugs.has(unique)) { unique = `${slug}-${n++}`; }
      usedSlugs.add(unique);

      const img = sharp(srcPath, { failOn: 'none' }).rotate();
      const meta = await img.metadata();
      if (!meta.width || !meta.height) { skipped++; continue; }
      if (meta.width < 400 && meta.height < 400) { skipped++; continue; } // icons/logos, not gallery photos

      const fullJpg = path.join(OUT, `${unique}.jpg`);
      const fullWebp = path.join(OUT, `${unique}.webp`);
      const thumbJpg = path.join(OUT, `${unique}-thumb.jpg`);
      const thumbWebp = path.join(OUT, `${unique}-thumb.webp`);

      await sharp(srcPath, { failOn: 'none' }).rotate()
        .resize({ width: FULL_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toFile(fullJpg);

      await sharp(srcPath, { failOn: 'none' }).rotate()
        .resize({ width: FULL_WIDTH, withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(fullWebp);

      await sharp(srcPath, { failOn: 'none' }).rotate()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true })
        .toFile(thumbJpg);

      await sharp(srcPath, { failOn: 'none' }).rotate()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .webp({ quality: 68 })
        .toFile(thumbWebp);

      const outMeta = await sharp(fullJpg).metadata();
      manifest.push({
        slug: unique,
        originalFile: file,
        width: outMeta.width,
        height: outMeta.height,
        jpg: `assets/images/gallery/${unique}.jpg`,
        webp: `assets/images/gallery/${unique}.webp`,
        thumbJpg: `assets/images/gallery/${unique}-thumb.jpg`,
        thumbWebp: `assets/images/gallery/${unique}-thumb.webp`
      });
      ok++;
      if (ok % 25 === 0) console.log(`...${ok} done`);
    } catch (e) {
      failed++;
      console.error('FAILED', file, e.message);
    }
  }

  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
  console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
  console.log(`Manifest: ${MANIFEST_OUT}`);
}

run();
