// Nachbearbeitung der HTML-Seiten (von build.js aufgerufen, idempotent):
//  - Breadcrumbs als <nav><ol>, ein gebündelter JSON-LD-Block (School, BreadcrumbList, FAQPage, NewsArticle)
//  - theme-color-Meta
//  - <img>: width/height, decoding, srcset/sizes, Hero = fetchpriority high ohne lazy, Logo-Variante
const { loadMeta, setAttr, removeAttr, getAttr, srcsetFor } = require('./img-util');

const DOMAIN = 'https://grundschule-flegessen.de';
const SCHOOL_ID = DOMAIN + '/#school';
const LD_PAGES = ['index.html', 'unsere-schule.html', 'eltern.html', 'schulalltag.html', 'aktuelles.html', 'kontakt.html', 'team.html', 'klassen.html', 'unterrichtszeiten.html', 'mitteilungen.html', 'galerie.html'];
const AREA = ['Flegessen', 'Klein Süntel', 'Hasperde', 'Hachmühlen', 'Brullsen', 'Bad Münder am Deister'];

const stripTags = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const abs = (file) => (/^https?:/.test(file) ? file : DOMAIN + '/' + file.replace(/^\//, ''));

function parseGermanDate(str) {
  const s = String(str || '');
  const year = (s.match(/(\d{4})/) || [])[1];
  const first = s.match(/^\s*(\d{1,2})\.(?:(\d{1,2})\.)?/);
  if (!year || !first) return null;
  let month = first[2];
  if (!month) month = (s.match(/[–-]\s*\d{1,2}\.(\d{1,2})\./) || [])[1];
  if (!month) return null;
  const d = +first[1], m = +month;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return year + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function schoolNode(content) {
  const s = content.site || {};
  return {
    '@type': 'School',
    '@id': SCHOOL_ID,
    name: s.name || 'Grundschule Flegessen',
    alternateName: s.shortName || 'GS Flegessen',
    url: DOMAIN + '/',
    logo: abs((s.logo && s.logo.file) || 'assets/images/site/logo.jpg'),
    image: abs((s.ogImage && s.ogImage.file) || 'assets/images/site/og-image.jpg'),
    telephone: (s.phoneHref || 'tel:+49504253060').replace(/^tel:/, ''),
    email: s.email || 'gs-flegessen@t-online.de',
    address: {
      '@type': 'PostalAddress',
      streetAddress: s.street || 'Gülichstr. 1',
      postalCode: s.zip || '31848',
      addressLocality: s.city || 'Bad Münder',
      addressRegion: s.region || 'Niedersachsen',
      addressCountry: s.country || 'DE'
    },
    geo: { '@type': 'GeoCoordinates', latitude: 52.1554, longitude: 9.4410 },
    foundingDate: '1934',
    areaServed: AREA.map((n) => ({ '@type': 'Place', name: n }))
  };
}

function jsonLd(file, title, content) {
  const graph = [schoolNode(content)];
  if (file !== 'index.html') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: DOMAIN + '/' },
        { '@type': 'ListItem', position: 2, name: title, item: DOMAIN + '/' + file }
      ]
    });
  }
  const pages = content.pages || {};
  if (file === 'eltern.html' && pages.eltern && Array.isArray(pages.eltern.faq) && pages.eltern.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: pages.eltern.faq.filter((f) => f.question && f.answer).map((f) => ({
        '@type': 'Question', name: stripTags(f.question),
        acceptedAnswer: { '@type': 'Answer', text: stripTags(f.answer) }
      }))
    });
  }
  if (file === 'aktuelles.html' && pages.aktuelles && Array.isArray(pages.aktuelles.posts)) {
    for (const p of pages.aktuelles.posts) {
      const date = parseGermanDate(p.date);
      if (!date || !p.title) continue;
      const a = {
        '@type': 'NewsArticle',
        headline: stripTags(p.title),
        description: stripTags(p.html),
        datePublished: date,
        author: { '@id': SCHOOL_ID },
        publisher: { '@id': SCHOOL_ID },
        mainEntityOfPage: DOMAIN + '/aktuelles.html'
      };
      if (p.image && p.image.file) a.image = abs(p.image.file);
      graph.push(a);
    }
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

// --- <img> ---
const SIZES = {
  team: '(max-width: 620px) 96px, 132px',
  tile4: '(max-width: 620px) calc(100vw - 48px), (max-width: 920px) 45vw, 270px',
  tile3: '(max-width: 620px) calc(100vw - 48px), (max-width: 920px) 45vw, 370px',
  card: '(max-width: 620px) calc(100vw - 48px), (max-width: 1180px) 45vw, 540px',
  post: '(max-width: 620px) calc(100vw - 48px), 220px',
  pageHero: '(max-width: 1180px) 100vw, 1180px',
  hero: '(max-width: 860px) 100vw, 560px'
};

function enhanceImages(html, meta) {
  let heroSeen = false;
  return html.replace(/<img\b[^>]*>/g, (tag, idx) => {
    let src = getAttr(tag, 'src');
    if (!src) return tag;
    const pre = html.slice(Math.max(0, idx - 250), idx);
    const parent = pre.match(/<(\w+)([^<>]*)>\s*$/);
    const cls = parent ? (getAttr(parent[2].replace(/^/, ' '), 'class') || '').split(/\s+/) : [];
    const has = (c) => cls.includes(c);

    // Logo: kleine Variante (nur Kopf/Fuß), Größe bleibt wie angegeben
    if (has('brand') || has('site-footer__brand')) {
      if (src === 'assets/images/site/logo.jpg' && meta['assets/images/site/logo.jpg'] && meta['assets/images/site/logo.jpg'].variants.some((v) => v.w === 96)) {
        tag = setAttr(tag, 'src', 'assets/images/site/logo-96.jpg');
      }
      if (!getAttr(tag, 'width')) tag = setAttr(tag, 'width', has('brand') ? 48 : 44);
      if (!getAttr(tag, 'height')) tag = setAttr(tag, 'height', has('brand') ? 48 : 44);
      return setAttr(tag, 'decoding', 'async');
    }

    const orig = src;
    const m = meta[orig];
    if (m) { tag = setAttr(tag, 'width', m.w); tag = setAttr(tag, 'height', m.h); }
    tag = setAttr(tag, 'decoding', 'async');

    const isPageHero = has('page-hero__media');
    const isHero = has('hero__media') && !heroSeen && /<section class="hero"/.test(html.slice(0, idx));
    if (has('hero__media')) heroSeen = true;

    let sizes = null;
    if (isPageHero) sizes = SIZES.pageHero;
    else if (has('hero__media')) sizes = SIZES.hero;
    else if (has('team-card__photo')) sizes = SIZES.team;
    else if (has('tile__media')) {
      const g = [...html.slice(0, idx).matchAll(/class="[^"]*\bgrid--(\d)\b/g)].pop();
      sizes = g && g[1] === '3' ? SIZES.tile3 : SIZES.tile4;
    }
    else if (has('card__media')) sizes = SIZES.card;
    else if (has('post-card__media')) sizes = SIZES.post;

    const srcset = srcsetFor(orig, meta);
    if (srcset) tag = setAttr(tag, 'srcset', srcset);
    if (sizes && srcset) tag = setAttr(tag, 'sizes', sizes);

    if (isPageHero || isHero) {
      tag = removeAttr(tag, 'loading');
      tag = setAttr(tag, 'fetchpriority', 'high');
    } else if (!/\sloading="/.test(tag)) {
      tag = setAttr(tag, 'loading', 'lazy');
    }
    return tag;
  });
}

function enhance(html, file, content, meta) {
  meta = meta || loadMeta();
  const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/\s*–\s*Grundschule Flegessen\s*$/, '');

  // Breadcrumbs
  if (file !== 'index.html' && title) {
    const nav = '<nav class="breadcrumbs" aria-label="Brotkrumen"><ol><li><a href="index.html">Home</a></li><li aria-current="page">' + title + '</li></ol></nav>';
    html = html.replace(/<(p|nav) class="breadcrumbs"[^>]*>[\s\S]*?<\/\1>/, nav);
  }

  // JSON-LD: alle bestehenden Blöcke durch einen gebündelten ersetzen
  if (LD_PAGES.includes(file)) {
    const block = '<script type="application/ld+json" id="ld-schema">\n' + JSON.stringify(jsonLd(file, title, content), null, 2).replace(/</g, '\\u003c') + '\n</script>';
    const re = /<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>\n?/g;
    const first = html.search(re);
    html = html.replace(re, '');
    if (first >= 0) html = html.slice(0, first) + block + '\n' + html.slice(first);
    else html = html.replace('</head>', block + '\n</head>');
    for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  }

  if (!/<meta name="theme-color"/.test(html)) html = html.replace(/(<meta name="color-scheme"[^>]*>\n?)/, '$1<meta name="theme-color" content="#00789f">\n');

  return enhanceImages(html, meta);
}

module.exports = { enhance, parseGermanDate };
