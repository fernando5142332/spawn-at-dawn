#!/usr/bin/env node
// Genera el sitio estático en dist/ a partir de site.config.json y data/editions/*.json.
// Sin dependencias. Uso: node scripts/build.mjs   (SITE_URL=https://… para sobrescribir siteUrl)
import { readFile, writeFile, mkdir, readdir, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const cfg = JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE = (process.env.SITE_URL || cfg.siteUrl).replace(/\/$/, '');
const BASE = new URL(SITE).pathname.replace(/\/$/, '');
const LANGS = ['es', 'en'];
const ads = cfg.monetization?.adsenseClient || '';
const premium = cfg.monetization?.premium ?? {};
const premiumOn = Boolean(ads && premium.checkoutUrl);

export const CATS = {
  juegos: { hue: 168, code: 'GG', es: 'Juegos', en: 'Games' },
  playstation: { hue: 222, code: 'PS', es: 'PlayStation', en: 'PlayStation' },
  xbox: { hue: 132, code: 'XB', es: 'Xbox', en: 'Xbox' },
  nintendo: { hue: 354, code: 'NS', es: 'Nintendo', en: 'Nintendo' },
  pc: { hue: 262, code: 'PC', es: 'PC', en: 'PC' },
  movil: { hue: 28, code: 'MO', es: 'Móvil', en: 'Mobile' },
  industria: { hue: 196, code: 'BIZ', es: 'Industria', en: 'Industry' },
  indie: { hue: 318, code: 'IND', es: 'Indie', en: 'Indie' },
  adaptaciones: { hue: 44, code: 'TV', es: 'Cine y TV', en: 'Film & TV' },
  hardware: { hue: 286, code: 'HW', es: 'Hardware', en: 'Hardware' },
  esports: { hue: 12, code: 'ESP', es: 'Esports', en: 'Esports' },
};

const T = {
  es: {
    locale: 'es-ES', today: 'Hoy', archive: 'Archivo', about: 'Acerca de', privacy: 'Privacidad', premium: 'Sin anuncios',
    edition: 'Edición', ticker: 'En titulares', all: 'Todo', allNews: 'Las noticias del día', briefs: 'Breves',
    releases: 'Ya disponible y a la vista', social: 'Se comenta en redes', steam: 'Lo más vendido en Steam',
    read: 'Leer noticia', nSources: (n) => `${n} ${n === 1 ? 'fuente' : 'fuentes'}`, sourcesTitle: 'Fuentes',
    sourcesNote: 'Resumen propio elaborado a partir de estas fuentes. Visítalas para leer la información completa.',
    why: 'Por qué importa', image: 'Imagen', minRead: (n) => `${n} min de lectura`, more: 'Más de esta edición', share: 'Compartir', copy: 'Copiar enlace', copied: '¡Copiado!',
    back: 'Volver a la edición', archiveTitle: 'Todas las ediciones', nStories: (n) => `${n} noticias`,
    follow: 'No te pierdas la de mañana', followText: 'Una edición nueva cada mañana. Sin ruido y con las fuentes enlazadas.',
    footer: 'Resúmenes propios con enlaces a las fuentes originales. Las marcas y juegos citados pertenecen a sus respectivos propietarios.',
    notFound: 'Aquí no hay nada… todavía', home: 'Ir a la portada', ad: 'Publicidad', theme: 'Cambiar entre tema claro y oscuro', otherLang: 'English', latest: 'Última edición',
  },
  en: {
    locale: 'en-GB', today: 'Today', archive: 'Archive', about: 'About', privacy: 'Privacy', premium: 'Go ad-free',
    edition: 'Edition', ticker: 'Headlines', all: 'All', allNews: "Today's stories", briefs: 'In brief',
    releases: 'Out now and coming up', social: 'Trending on social', steam: 'Steam top sellers',
    read: 'Read story', nSources: (n) => `${n} ${n === 1 ? 'source' : 'sources'}`, sourcesTitle: 'Sources',
    sourcesNote: 'Our own summary based on these sources. Visit them for the full story.',
    why: 'Why it matters', image: 'Image', minRead: (n) => `${n} min read`, more: 'More from this edition', share: 'Share', copy: 'Copy link', copied: 'Copied!',
    back: 'Back to the edition', archiveTitle: 'All editions', nStories: (n) => `${n} stories`,
    follow: "Don't miss tomorrow's", followText: 'A fresh edition every morning. No noise, sources always linked.',
    footer: 'Original summaries linking to the original sources. All trademarks and games mentioned belong to their respective owners.',
    notFound: 'Nothing here… yet', home: 'Go to the front page', ad: 'Advertisement', theme: 'Toggle light and dark theme', otherLang: 'Español', latest: 'Latest edition',
  },
};

// Rutas por idioma. El español vive en la raíz y el inglés bajo /en/.
const SEG = { es: { archive: 'archivo', about: 'acerca', privacy: 'privacidad', premium: 'sin-anuncios' }, en: { archive: 'archive', about: 'about', privacy: 'privacy', premium: 'ad-free' } };
const pre = (l) => (l === 'es' ? '' : '/en');
const P = {
  home: (l) => `${pre(l)}/`,
  archive: (l) => `${pre(l)}/${SEG[l].archive}/`,
  edition: (l, d) => `${pre(l)}/${SEG[l].archive}/${d}/`,
  story: (l, d, id) => `${pre(l)}/n/${d}/${id}/`,
  page: (l, k) => `${pre(l)}/${SEG[l][k]}/`,
  feed: (l) => `${pre(l)}/feed.xml`,
};
const u = (p) => BASE + p;
const abs = (p) => SITE + p;

const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (d, l, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) => new Intl.DateTimeFormat(T[l].locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const pad = (n) => String(n).padStart(2, '0');

// Las imágenes solo pueden venir de las fuentes que devuelve scripts/find-image.mjs.
const IMG_HOSTS = /(^|\.)(steamstatic\.com|ytimg\.com|wikimedia\.org)$/;
const okImage = (url) => { try { const x = new URL(url); return x.protocol === 'https:' && IMG_HOSTS.test(x.hostname); } catch { return false; } };

function validate(ed, file) {
  const errs = [];
  const both = (o, where) => { for (const l of LANGS) if (typeof o?.[l] !== 'string' || !o[l].trim()) errs.push(`${where}: falta el texto "${l}"`); };
  const link = (s, where) => { if (!s?.name || !/^https?:\/\//.test(s?.url ?? '')) errs.push(`${where}: hace falta name y url (http/https)`); };
  if (`${ed.date}.json` !== file || !/^\d{4}-\d{2}-\d{2}$/.test(ed.date ?? '')) errs.push('date debe ser AAAA-MM-DD y coincidir con el nombre del archivo');
  both(ed.headline, 'headline'); both(ed.intro, 'intro');
  if (!Array.isArray(ed.stories) || ed.stories.length < 4) errs.push('stories: hacen falta al menos 4 noticias');
  const ids = new Set();
  for (const [i, s] of (ed.stories ?? []).entries()) {
    const w = `stories[${i}] "${s.id}"`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id ?? '') || s.id.length > 70) errs.push(`${w}: id debe ser un slug en minúsculas (máx. 70)`);
    if (ids.has(s.id)) errs.push(`${w}: id repetido`);
    ids.add(s.id);
    if (!CATS[s.category]) errs.push(`${w}: category desconocida "${s.category}" (válidas: ${Object.keys(CATS).join(', ')})`);
    both(s.title, `${w}.title`); both(s.dek, `${w}.dek`); both(s.why, `${w}.why`);
    for (const l of LANGS) if (!Array.isArray(s.body?.[l]) || !s.body[l].length || s.body[l].some((p) => typeof p !== 'string' || !p.trim())) errs.push(`${w}.body.${l}: debe ser una lista de párrafos`);
    if (!Array.isArray(s.sources) || !s.sources.length) errs.push(`${w}.sources: al menos una fuente`);
    (s.sources ?? []).forEach((x, k) => link(x, `${w}.sources[${k}]`));
    if (s.image) {
      if (!okImage(s.image.url) || (s.image.thumb && !okImage(s.image.thumb))) errs.push(`${w}.image: url y thumb deben ser https de Steam, YouTube o Wikimedia (usa scripts/find-image.mjs)`);
      if (!s.image.credit) errs.push(`${w}.image.credit: falta el crédito`);
      for (const k of ['creditUrl', 'licenseUrl']) if (s.image[k] && !/^https?:\/\//.test(s.image[k])) errs.push(`${w}.image.${k}: debe ser http/https`);
    }
  }
  (ed.briefs ?? []).forEach((b, i) => { both(b.text, `briefs[${i}].text`); link(b.source, `briefs[${i}].source`); });
  (ed.social ?? []).forEach((b, i) => { both(b.text, `social[${i}].text`); link(b.source, `social[${i}].source`); });
  (ed.releases ?? []).forEach((r, i) => { if (!r.title || !r.platforms) errs.push(`releases[${i}]: title y platforms`); if (r.url && !/^https?:\/\//.test(r.url)) errs.push(`releases[${i}].url: debe ser http/https`); both(r.note, `releases[${i}].note`); });
  (ed.steam ?? []).forEach((g, i) => link(g, `steam[${i}]`));
  return errs;
}

// ---------- datos ----------
const files = (await readdir(path.join(ROOT, 'data/editions'))).filter((f) => f.endsWith('.json')).sort().reverse();
const editions = [];
const problems = [];
for (const f of files) {
  let ed;
  try { ed = JSON.parse(await readFile(path.join(ROOT, 'data/editions', f), 'utf8')); } catch (err) { problems.push(`${f}: JSON inválido — ${err.message}`); continue; }
  const errs = validate(ed, f);
  if (errs.length) problems.push(...errs.map((x) => `${f}: ${x}`));
  editions.push(ed);
}
if (!editions.length) problems.push('No hay ediciones en data/editions/');
if (problems.length) { console.error(`✖ ${problems.length} problema(s):\n- ${problems.join('\n- ')}`); process.exit(1); }
editions.forEach((ed, i) => { ed.number = editions.length - i; });

// ---------- piezas ----------
const seed = (id) => { const h = createHash('md5').update(id).digest(); return { p: h[0] % 5, d: 40 + (h[1] % 80), x: 8 + (h[2] % 80) }; };
// Ilustración de la noticia: su imagen si la tiene y, debajo (o si falla la carga), el arte generado.
const art = (s, n, extra = '', big = false) => {
  const c = CATS[s.category];
  const r = seed(s.id);
  const src = s.image && (big ? s.image.url : s.image.thumb ?? s.image.url);
  const img = src ? `<img src="${e(src)}" alt="" ${big ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<div class="art p${r.p} ${extra}" style="--h:${c.hue};--d:${r.d};--x:${r.x}" aria-hidden="true">${img}<span class="glyph">${c.code}</span><span class="num">${pad(n)}</span></div>`;
};
const credit = (s, l) => {
  if (!s.image) return '';
  const a = (href, label) => (href ? `<a href="${e(href)}" target="_blank" rel="noopener nofollow">${e(label)}</a>` : e(label));
  return `<p class="credit">${T[l].image}: ${a(s.image.creditUrl, s.image.credit)}${s.image.license ? ` · ${a(s.image.licenseUrl, s.image.license)}` : ''}</p>`;
};
const tag = (s, l) => `<span class="tag" style="--h:${CATS[s.category].hue}">${e(CATS[s.category][l])}</span>`;
const ext = (s, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${e(s.url)}" target="_blank" rel="noopener nofollow">${e(s.name)}</a>`;
const adSlot = (k, l) => (ads && cfg.monetization.slots?.[k] ? `<aside class="ad" data-ad aria-label="${T[l].ad}"><small>${T[l].ad}</small><ins class="adsbygoogle" style="display:block" data-ad-client="${e(ads)}" data-ad-slot="${e(cfg.monetization.slots[k])}" data-ad-format="auto" data-full-width-responsive="true"></ins></aside>` : '');

const SOCIAL = {
  bluesky: ['Bluesky', (v) => `https://bsky.app/profile/${v}`], mastodon: ['Mastodon', (v) => v], x: ['X', (v) => `https://x.com/${v}`],
  telegram: ['Telegram', (v) => `https://t.me/${v}`], threads: ['Threads', (v) => `https://www.threads.com/@${v}`], instagram: ['Instagram', (v) => `https://instagram.com/${v}`], tiktok: ['TikTok', (v) => `https://www.tiktok.com/@${v}`],
  youtube: ['YouTube', (v) => `https://www.youtube.com/@${v}`], discord: ['Discord', (v) => v],
};
const socialLinks = () => Object.entries(cfg.social ?? {}).filter(([k, v]) => v && SOCIAL[k]).map(([k, v]) => `<a href="${e(SOCIAL[k][1](v))}" target="_blank" rel="me noopener">${SOCIAL[k][0]}</a>`);

const css = await readFile(path.join(ROOT, 'src/style.css'), 'utf8');
const js = await readFile(path.join(ROOT, 'src/app.js'), 'utf8');
const ver = createHash('md5').update(css + js).digest('hex').slice(0, 8);
const [w1, ...wRest] = cfg.name.split(' ');
const logo = `<svg viewBox="0 0 9 8" width="26" height="23" aria-hidden="true"><path fill="currentColor" d="M2 1h2v1H2zM5 1h2v1H5zM1 2h7v2H1zM2 4h5v1H2zM3 5h3v1H3zM4 6h1v1H4z"/></svg>`;

function shell({ lang, title, desc, paths, body, type = 'website', jsonld, nav = '', image = abs('/assets/og.png') }) {
  const t = T[lang];
  const other = lang === 'es' ? 'en' : 'es';
  const full = title === cfg.name ? `${cfg.name} — ${cfg.tagline[lang]}` : `${title} · ${cfg.name}`;
  const navLink = (k, href, label) => `<a href="${u(href)}"${nav === k ? ' aria-current="page"' : ''}>${label}</a>`;
  const follow = socialLinks();
  return `<!doctype html>
<html lang="${lang}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(full)}</title>
<meta name="description" content="${e(desc)}">
<link rel="canonical" href="${abs(paths[lang])}">
${LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${abs(paths[l])}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${abs(paths.es)}">
<link rel="alternate" type="application/rss+xml" title="${e(cfg.name)}" href="${abs(P.feed(lang))}">
<meta property="og:site_name" content="${e(cfg.name)}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:url" content="${abs(paths[lang])}">
<meta property="og:image" content="${e(image)}">
<meta property="og:locale" content="${lang === 'es' ? 'es_ES' : 'en_GB'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#090a0f">
<link rel="icon" href="${u('/favicon.ico')}" sizes="48x48">
<link rel="icon" href="${u('/favicon.svg')}" type="image/svg+xml">
<link rel="icon" href="${u('/favicon-192.png')}" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${u('/apple-touch-icon.png')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${u('/assets/style.css')}?v=${ver}">
<script>try{var t=localStorage.getItem('rd-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
${ads ? `<meta name="google-adsense-account" content="${e(ads)}">` : ''}${cfg.verification?.google ? `<meta name="google-site-verification" content="${e(cfg.verification.google)}">` : ''}${cfg.verification?.bing ? `<meta name="msvalidate.01" content="${e(cfg.verification.bing)}">` : ''}${jsonld ? `\n<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">${lang === 'es' ? 'Saltar al contenido' : 'Skip to content'}</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="${u(P.home(lang))}">${logo}<span><b>${e(w1)}</b>${wRest.length ? ` ${e(wRest.join(' '))}` : ''}</span></a>
    <nav aria-label="${lang === 'es' ? 'Principal' : 'Main'}">
      ${navLink('home', P.home(lang), t.today)}
      ${navLink('archive', P.archive(lang), t.archive)}
      ${navLink('about', P.page(lang, 'about'), t.about)}
    </nav>
    <div class="tools">
      <a class="lang" href="${u(paths[other])}" hreflang="${other}" lang="${other}" title="${T[lang].otherLang}">${other.toUpperCase()}</a>
      <button class="theme" type="button" aria-label="${t.theme}" title="${t.theme}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.5 0-.9-.1-1.4A6.5 6.5 0 0 1 12 3Z"/></svg></button>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <div class="foot-top">
      <a class="brand" href="${u(P.home(lang))}">${logo}<span><b>${e(w1)}</b>${wRest.length ? ` ${e(wRest.join(' '))}` : ''}</span></a>
      <nav aria-label="${lang === 'es' ? 'Pie' : 'Footer'}">
        <a href="${u(P.archive(lang))}">${t.archive}</a>
        <a href="${u(P.page(lang, 'about'))}">${t.about}</a>
        <a href="${u(P.page(lang, 'privacy'))}">${t.privacy}</a>
        ${premiumOn ? `<a href="${u(P.page(lang, 'premium'))}">${t.premium}</a>` : ''}
        <a href="${u(P.feed(lang))}">RSS</a>
        ${follow.join('\n        ')}
      </nav>
    </div>
    <p>${t.footer}</p>
    <p>© ${new Date().getUTCFullYear()} ${e(cfg.name)}</p>
  </div>
</footer>
<script>window.RD=${JSON.stringify({ ads, premium: premiumOn ? premium.codeHashes ?? [] : [], copied: t.copied })}</script>
<script src="${u('/assets/app.js')}?v=${ver}" defer></script>
</body>
</html>
`;
}

const card = (ed, s, n, l, cls = '') => `<article class="card ${cls}" data-cat="${s.category}">
  <a class="card-art" href="${u(P.story(l, ed.date, s.id))}" tabindex="-1" aria-hidden="true">${art(s, n)}</a>
  <div class="card-body">
    <p class="meta">${tag(s, l)}<span>${T[l].nSources(s.sources.length)}</span></p>
    <h3><a href="${u(P.story(l, ed.date, s.id))}">${e(s.title[l])}</a></h3>
    <p class="dek">${e(s.dek[l])}</p>
  </div>
</article>`;

function editionBody(ed, l) {
  const t = T[l];
  const [lead, ...rest] = ed.stories;
  const side = rest.slice(0, 2);
  const grid = rest.slice(2);
  const cats = [...new Set(grid.map((s) => s.category))];
  const tick = ed.stories.map((s) => `<a href="${u(P.story(l, ed.date, s.id))}">${e(s.title[l])}</a>`).join('<i>✦</i>') + '<i>✦</i>';
  const follow = socialLinks();
  return `<div class="ticker" aria-hidden="true"><b>${t.ticker}</b><div class="track"><div class="run">${tick}</div><div class="run">${tick}</div></div></div>
<div class="wrap">
  <section class="mast">
    <p class="kicker"><span class="dot"></span>${t.edition} ${l === 'es' ? 'n.º' : 'no.'} ${ed.number} · <time datetime="${ed.date}">${fmtDate(ed.date, l)}</time></p>
    <h1>${e(ed.headline[l])}</h1>
    <p class="intro">${e(ed.intro[l])}</p>
  </section>

  <section class="lead" aria-label="${t.allNews}">
    <article class="hero" data-cat="${lead.category}">
      ${art(lead, 1, 'fill', true)}
      <div class="hero-body">
        <p class="meta">${tag(lead, l)}<span>${t.nSources(lead.sources.length)}</span></p>
        <h2><a href="${u(P.story(l, ed.date, lead.id))}">${e(lead.title[l])}</a></h2>
        <p class="dek">${e(lead.dek[l])}</p>
        <span class="cta">${t.read} →</span>
      </div>
    </article>
    <div class="lead-side">
      ${side.map((s, i) => card(ed, s, i + 2, l, 'row')).join('\n      ')}
    </div>
  </section>
  ${adSlot('home', l)}
  <section class="block">
    <div class="block-head">
      <h2>${t.allNews}</h2>
      <div class="chips" role="group" aria-label="${l === 'es' ? 'Filtrar por categoría' : 'Filter by category'}">
        <button type="button" class="chip on" data-filter="">${t.all}</button>
        ${cats.map((c) => `<button type="button" class="chip" data-filter="${c}" style="--h:${CATS[c].hue}">${e(CATS[c][l])}</button>`).join('\n        ')}
      </div>
    </div>
    <div class="grid">
      ${grid.map((s, i) => card(ed, s, i + 4, l)).join('\n      ')}
    </div>
  </section>

  <section class="cols">
    <div class="briefs">
      <h2>${t.briefs}</h2>
      <ol>
        ${(ed.briefs ?? []).map((b) => `<li><p>${e(b.text[l])}</p>${ext(b.source, 'via')}</li>`).join('\n        ')}
      </ol>
    </div>
    <div class="side">
      ${ed.releases?.length ? `<section class="panel"><h2>${t.releases}</h2><ul class="rel">${ed.releases.map((r) => `<li>${r.url ? `<a href="${e(r.url)}" target="_blank" rel="noopener nofollow">${e(r.title)}</a>` : `<b>${e(r.title)}</b>`}<span>${e(r.platforms)}</span><em>${e(r.note[l])}</em></li>`).join('')}</ul></section>` : ''}
      ${ed.social?.length ? `<section class="panel"><h2>${t.social}</h2><ul class="buzz">${ed.social.map((b) => `<li><p>${e(b.text[l])}</p>${ext(b.source, 'via')}</li>`).join('')}</ul></section>` : ''}
      ${ed.steam?.length ? `<section class="panel"><h2>${t.steam}</h2><ol class="chart">${ed.steam.map((g) => `<li>${ext(g)}</li>`).join('')}</ol></section>` : ''}
    </div>
  </section>

  <section class="follow">
    <div>
      <h2>${t.follow}</h2>
      <p>${t.followText}</p>
    </div>
    <div class="follow-links">
      ${follow.join('')}<a href="${u(P.feed(l))}">RSS</a><a href="${u(P.archive(l))}">${t.archive}</a>
    </div>
  </section>
</div>`;
}

function storyBody(ed, s, n, l) {
  const t = T[l];
  const url = abs(P.story(l, ed.date, s.id));
  const txt = encodeURIComponent(s.title[l]);
  const eu = encodeURIComponent(url);
  const words = [s.dek[l], ...s.body[l], s.why[l]].join(' ').split(/\s+/).length;
  const start = (ed.stories.indexOf(s) + 1) % ed.stories.length;
  const more = [...ed.stories.slice(start), ...ed.stories.slice(0, start)].filter((x) => x !== s).slice(0, 3);
  return `<div class="wrap narrow">
  <article class="story">
    <a class="back" href="${u(ed.number === editions.length ? P.home(l) : P.edition(l, ed.date))}">← ${t.back}</a>
    <p class="meta">${tag(s, l)}<time datetime="${ed.date}">${fmtDate(ed.date, l, { day: 'numeric', month: 'long', year: 'numeric' })}</time><span>${t.minRead(Math.max(1, Math.round(words / 200)))}</span></p>
    <h1>${e(s.title[l])}</h1>
    <p class="standfirst">${e(s.dek[l])}</p>
    ${art(s, n, 'wide', true)}
    ${credit(s, l)}
    <div class="prose">
      ${s.body[l].map((p) => `<p>${e(p)}</p>`).join('\n      ')}
    </div>
    <aside class="why" style="--h:${CATS[s.category].hue}"><h2>${t.why}</h2><p>${e(s.why[l])}</p></aside>
    <section class="sources">
      <h2>${t.sourcesTitle}</h2>
      <ul>${s.sources.map((x) => `<li>${ext(x)}</li>`).join('')}</ul>
      <p>${t.sourcesNote}</p>
    </section>
    <div class="share">
      <span>${t.share}</span>
      <a href="https://bsky.app/intent/compose?text=${txt}%20${eu}" target="_blank" rel="noopener">Bluesky</a>
      <a href="https://x.com/intent/post?text=${txt}&url=${eu}" target="_blank" rel="noopener">X</a>
      <a href="https://wa.me/?text=${txt}%20${eu}" target="_blank" rel="noopener">WhatsApp</a>
      <a href="https://t.me/share/url?url=${eu}&text=${txt}" target="_blank" rel="noopener">Telegram</a>
      <button type="button" data-copy="${e(url)}">${t.copy}</button>
    </div>
  </article>
  ${adSlot('article', l)}
</div>
<div class="wrap">
  <section class="block">
    <div class="block-head"><h2>${t.more}</h2></div>
    <div class="grid">
      ${more.map((x) => card(ed, x, ed.stories.indexOf(x) + 1, l)).join('\n      ')}
    </div>
  </section>
</div>`;
}

function archiveBody(l) {
  const t = T[l];
  return `<div class="wrap narrow">
  <section class="mast small"><p class="kicker"><span class="dot"></span>${t.archive}</p><h1>${t.archiveTitle}</h1></section>
  <ol class="editions">
    ${editions.map((ed, i) => `<li><a href="${u(i === 0 ? P.home(l) : P.edition(l, ed.date))}"><span class="n">${pad(ed.number)}</span><span class="what"><time datetime="${ed.date}">${fmtDate(ed.date, l)}</time><b>${e(ed.headline[l])}</b></span><span class="count">${t.nStories(ed.stories.length)}</span></a></li>`).join('\n    ')}
  </ol>
</div>`;
}

const mail = cfg.contactEmail ? `<a href="mailto:${e(cfg.contactEmail)}">${e(cfg.contactEmail)}</a>` : '';
const PAGES = {
  about: {
    es: { title: `Acerca de ${cfg.name}`, html: `
<p><b>${e(cfg.name)}</b> es un resumen diario de la actualidad de los videojuegos. Cada mañana repasamos lo publicado por los principales medios especializados en español e inglés, los blogs oficiales de las plataformas y las comunidades más activas, y lo condensamos en una edición que se lee en pocos minutos.</p>
<h2>Cómo se hace</h2>
<p>La selección y la redacción de cada edición se realizan con ayuda de inteligencia artificial, que revisa cientos de titulares, agrupa los que hablan de lo mismo y redacta un resumen propio. No copiamos artículos: cada noticia enlaza siempre a las fuentes originales para que puedas leer la información completa y apoyar a quien la ha elaborado.</p>
<h2>Nuestras normas</h2>
<ul><li>Solo publicamos lo que podemos atribuir a una fuente enlazada.</li><li>Los rumores y las filtraciones se señalan como tales.</li><li>No reproducimos material filtrado ni destripamos argumentos.</li><li>Si nos equivocamos, corregimos.</li></ul>
<h2>Contacto</h2>
<p>${mail ? `¿Has visto un error o quieres proponernos una fuente? Escríbenos a ${mail}.` : 'Si eres el responsable de alguna de las fuentes citadas y quieres que dejemos de enlazarte o que corrijamos algo, lo haremos encantados.'}</p>` },
    en: { title: `About ${cfg.name}`, html: `
<p><b>${e(cfg.name)}</b> is a daily digest of video game news. Every morning we go through what the leading specialist outlets in Spanish and English, the platforms' official blogs and the busiest communities have published, and boil it down into an edition you can read in a few minutes.</p>
<h2>How it's made</h2>
<p>Each edition is selected and written with the help of artificial intelligence, which scans hundreds of headlines, groups the ones covering the same story and writes an original summary. We don't copy articles: every story links to its original sources so you can read the full report and support the people who produced it.</p>
<h2>Our rules</h2>
<ul><li>We only publish what we can attribute to a linked source.</li><li>Rumours and leaks are labelled as such.</li><li>We don't reproduce leaked material or spoil plots.</li><li>When we get something wrong, we fix it.</li></ul>
<h2>Contact</h2>
<p>${mail ? `Spotted a mistake or want to suggest a source? Email us at ${mail}.` : 'If you run one of the sources we cite and would like us to stop linking to you or to correct something, we will gladly do so.'}</p>` },
  },
  privacy: {
    es: { title: 'Política de privacidad', html: `
<p>${e(cfg.name)} no pide registro ni recoge datos personales por sí misma.</p>
<h2>Almacenamiento local</h2>
<p>Guardamos en tu navegador (localStorage) tu preferencia de tema claro u oscuro${premiumOn ? ' y, si lo activas, el modo sin anuncios' : ''}. Esa información no sale de tu dispositivo.</p>
<h2>Servicios de terceros</h2>
<p>Las tipografías se cargan desde Google Fonts y el sitio se sirve desde un proveedor de alojamiento externo; ambos pueden registrar datos técnicos como tu dirección IP para prestar el servicio.</p>
${ads ? `<h2>Publicidad</h2><p>Este sitio muestra anuncios de Google AdSense. Google y sus socios pueden usar cookies para mostrar anuncios basados en tus visitas a este y otros sitios web. Puedes gestionar tu consentimiento desde el aviso que aparece al entrar y desactivar la publicidad personalizada en <a href="https://adssettings.google.com" target="_blank" rel="noopener">adssettings.google.com</a>. Más información en <a href="https://policies.google.com/technologies/partner-sites?hl=es" target="_blank" rel="noopener">cómo usa Google los datos</a>.</p>` : ''}
<h2>Enlaces externos</h2>
<p>Las noticias enlazan a medios de terceros que tienen sus propias políticas de privacidad.</p>
${mail ? `<h2>Contacto</h2><p>Para cualquier consulta sobre privacidad, escribe a ${mail}.</p>` : ''}` },
    en: { title: 'Privacy policy', html: `
<p>${e(cfg.name)} requires no sign-up and does not collect personal data itself.</p>
<h2>Local storage</h2>
<p>We store your light or dark theme preference${premiumOn ? ' and, if you enable it, ad-free mode' : ''} in your browser (localStorage). That information never leaves your device.</p>
<h2>Third-party services</h2>
<p>Fonts are loaded from Google Fonts and the site is served by an external hosting provider; both may log technical data such as your IP address in order to deliver the service.</p>
${ads ? `<h2>Advertising</h2><p>This site shows Google AdSense ads. Google and its partners may use cookies to serve ads based on your visits to this and other websites. You can manage your consent from the notice shown when you arrive and opt out of personalised advertising at <a href="https://adssettings.google.com" target="_blank" rel="noopener">adssettings.google.com</a>. Learn more about <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">how Google uses data</a>.</p>` : ''}
<h2>External links</h2>
<p>Stories link to third-party outlets, which have their own privacy policies.</p>
${mail ? `<h2>Contact</h2><p>For any privacy enquiry, email ${mail}.</p>` : ''}` },
  },
  premium: {
    es: { title: 'Lee sin anuncios', html: `
<p>La publicidad mantiene ${e(cfg.name)} en marcha. Si prefieres leer sin anuncios, puedes apoyar el proyecto por ${e(premium.priceLabel?.es ?? '')} y recibirás un código que los desactiva en este navegador.</p>
<p><a class="btn" href="${e(premium.checkoutUrl ?? '')}" target="_blank" rel="noopener">Quiero apoyar el proyecto</a></p>
<h2>¿Ya tienes tu código?</h2>
<form class="code" data-premium><input name="code" autocomplete="off" placeholder="Código" aria-label="Código" required><button class="btn">Activar</button></form>
<p class="code-msg" data-ok="Listo: los anuncios están desactivados en este navegador." data-ko="Ese código no es válido o ha caducado." data-on="El modo sin anuncios está activo en este navegador." role="status"></p>` },
    en: { title: 'Read ad-free', html: `
<p>Advertising keeps ${e(cfg.name)} running. If you would rather read without ads, you can support the project for ${e(premium.priceLabel?.en ?? '')} and you will receive a code that switches them off in this browser.</p>
<p><a class="btn" href="${e(premium.checkoutUrl ?? '')}" target="_blank" rel="noopener">Support the project</a></p>
<h2>Already have a code?</h2>
<form class="code" data-premium><input name="code" autocomplete="off" placeholder="Code" aria-label="Code" required><button class="btn">Activate</button></form>
<p class="code-msg" data-ok="Done: ads are switched off in this browser." data-ko="That code is not valid or has expired." data-on="Ad-free mode is active in this browser." role="status"></p>` },
  },
};
const pageBody = (k, l) => `<div class="wrap narrow"><section class="mast small"><h1>${e(PAGES[k][l].title)}</h1></section><div class="prose page">${PAGES[k][l].html}</div></div>`;

// ---------- escritura ----------
const out = [];
const urls = [];
const put = (p, content) => out.push([p.endsWith('/') ? `${p}index.html` : p, content]);
const both = (fn) => Object.fromEntries(LANGS.map((l) => [l, fn(l)]));

for (const l of LANGS) {
  const t = T[l];
  const latest = editions[0];
  put(P.home(l), shell({
    lang: l, nav: 'home', title: cfg.name, desc: latest.intro[l], paths: both(P.home), body: editionBody(latest, l),
    jsonld: { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.name, alternateName: [cfg.name.replace(/\s+/g, ''), cfg.name.replace(/\s+/g, '').toLowerCase()], url: abs(P.home(l)), inLanguage: l, description: cfg.tagline[l], publisher: { '@type': 'Organization', name: cfg.name, url: abs('/'), logo: abs('/assets/og.png') } },
  }));
  put(P.archive(l), shell({ lang: l, nav: 'archive', title: t.archiveTitle, desc: cfg.tagline[l], paths: both(P.archive), body: archiveBody(l) }));
  for (const ed of editions) {
    const paths = both((x) => P.edition(x, ed.date));
    put(paths[l], shell({ lang: l, nav: 'archive', title: `${ed.headline[l]} — ${fmtDate(ed.date, l, { day: 'numeric', month: 'long', year: 'numeric' })}`, desc: ed.intro[l], paths, body: editionBody(ed, l) }));
    ed.stories.forEach((s, i) => {
      const sp = both((x) => P.story(x, ed.date, s.id));
      put(sp[l], shell({
        lang: l, title: s.title[l], desc: s.dek[l], paths: sp, type: 'article', body: storyBody(ed, s, i + 1, l), image: s.image?.url,
        jsonld: { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: s.title[l], description: s.dek[l], datePublished: `${ed.date}T07:00:00Z`, inLanguage: l, mainEntityOfPage: abs(sp[l]), image: s.image?.url ?? abs('/assets/og.png'), author: { '@type': 'Organization', name: cfg.name }, publisher: { '@type': 'Organization', name: cfg.name }, isBasedOn: s.sources.map((x) => x.url) },
      }));
      urls.push([sp[l], ed.date]);
    });
    urls.push([paths[l], ed.date]);
  }
  for (const k of ['about', 'privacy', ...(premiumOn ? ['premium'] : [])]) {
    put(P.page(l, k), shell({ lang: l, nav: k, title: PAGES[k][l].title, desc: cfg.tagline[l], paths: both((x) => P.page(x, k)), body: pageBody(k, l) }));
    urls.push([P.page(l, k), editions[0].date]);
  }
  urls.push([P.home(l), editions[0].date], [P.archive(l), editions[0].date]);

  const items = editions.slice(0, 7).flatMap((ed) => ed.stories.map((s) => `<item><title>${e(s.title[l])}</title><link>${abs(P.story(l, ed.date, s.id))}</link><guid isPermaLink="true">${abs(P.story(l, ed.date, s.id))}</guid><pubDate>${new Date(`${ed.date}T07:00:00Z`).toUTCString()}</pubDate><category>${e(CATS[s.category][l])}</category><description>${e(s.dek[l])}</description></item>`));
  put(P.feed(l), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${e(cfg.name)}</title><link>${abs(P.home(l))}</link><description>${e(cfg.tagline[l])}</description><language>${l}</language><atom:link href="${abs(P.feed(l))}" rel="self" type="application/rss+xml"/>\n${items.join('\n')}\n</channel></rss>\n`);
}

put('/404.html', shell({ lang: 'es', title: T.es.notFound, desc: cfg.tagline.es, paths: both(P.home), body: `<div class="wrap narrow"><section class="mast small"><p class="kicker"><span class="dot"></span>404 · Game over</p><h1>${T.es.notFound}</h1><p class="intro"><a class="btn" href="${u('/')}">${T.es.home}</a> <a class="btn ghost" href="${u('/en/')}">${T.en.home}</a></p></section></div>` }));
put('/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, d]) => `<url><loc>${abs(p)}</loc><lastmod>${d}</lastmod></url>`).join('\n')}\n</urlset>\n`);
put('/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
put('/assets/style.css', css);
put('/assets/app.js', js);
put('/.nojekyll', '');
if (ads) put('/ads.txt', `google.com, ${ads.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
if (cfg.customDomain) put('/CNAME', `${cfg.customDomain}\n`);
if (/^[a-zA-Z0-9-]{8,128}$/.test(cfg.indexNowKey ?? '')) put(`/${cfg.indexNowKey}.txt`, cfg.indexNowKey);

await rm(DIST, { recursive: true, force: true });
for (const [p, content] of out) {
  const file = path.join(DIST, p);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}
await cp(path.join(ROOT, 'src/static'), DIST, { recursive: true });

const last = editions[0];
console.log(`✔ ${out.length} archivos en dist/ · ${editions.length} edición(es) · última: ${last.date} (${last.stories.length} noticias, ${last.briefs?.length ?? 0} breves) · ${SITE}`);
