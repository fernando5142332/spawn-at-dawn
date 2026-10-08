#!/usr/bin/env node
// Descarga los RSS/Atom de sources.json y deja un resumen de titulares recientes en tmp/.
// Sin dependencias. Uso: node scripts/fetch-feeds.mjs [--hours 30]   |   node scripts/fetch-feeds.mjs --show ID [ID...]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argHours = process.argv.indexOf('--hours');
const HOURS = argHours > -1 ? Number(process.argv[argHours + 1]) : 30;
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

function clean(raw = '') {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = decode(s).replace(/<[^>]+>/g, ' ');
  return decode(s).replace(/\s+/g, ' ').trim();
}

const tag = (block, names) => {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return m[1];
  }
  return '';
};

function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.map((b) => {
    let link = clean(tag(b, ['link']));
    if (!/^https?:/.test(link)) {
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ?? b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = alt ? decode(alt[1]) : '';
    }
    const date = new Date(clean(tag(b, ['pubDate', 'published', 'dc:date', 'updated'])));
    const summary = clean(tag(b, ['description', 'summary', 'media:description', 'content:encoded', 'content']));
    return {
      title: clean(tag(b, ['title'])),
      link,
      date: isNaN(date) ? null : date.toISOString(),
      summary: summary.length > 320 ? summary.slice(0, 317) + '…' : summary,
    };
  }).filter((i) => i.title && i.link);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Algunos feeds (p. ej. Vandal) no vienen en UTF-8: se respeta el charset declarado.
  const declared = (res.headers.get('content-type') ?? '').match(/charset=([\w-]+)/i)?.[1] ?? buf.subarray(0, 200).toString('latin1').match(/encoding=["']([\w-]+)["']/i)?.[1] ?? 'utf-8';
  try { return new TextDecoder(declared).decode(buf); } catch { return buf.toString('utf8'); }
}

const showAt = process.argv.indexOf('--show');
if (showAt > -1) {
  const ids = new Set(process.argv.slice(showAt + 1).map((s) => s.toUpperCase()));
  const saved = JSON.parse(await readFile(path.join(ROOT, 'tmp/headlines.json'), 'utf8'));
  for (const s of saved.sources) for (const i of s.items) {
    if (ids.has(i.id)) console.log(`${i.id} · ${s.name} [${s.lang}] · ${i.date ?? 's/f'}\n${i.title}\n${i.link}\n${i.summary}\n`);
  }
  process.exit(0);
}

const { feeds, steam } = JSON.parse(await readFile(path.join(ROOT, 'sources.json'), 'utf8'));
const cutoff = Date.now() - HOURS * 3600e3;
const report = [];

async function load(f) {
  try {
    const all = parseFeed(await get(f.url));
    // Los feeds "top del día" de Reddit ya vienen filtrados; el resto se filtra por fecha.
    const items = all.filter((i) => f.kind === 'social' || !i.date || Date.parse(i.date) >= cutoff).slice(0, 40);
    report.push(`ok   ${String(items.length).padStart(3)}/${String(all.length).padEnd(3)} ${f.name}`);
    return { ...f, items };
  } catch (e) {
    report.push(`FAIL         ${f.name} — ${e.message}`);
    return { ...f, items: [], error: e.message };
  }
}

// Reddit corta las peticiones en paralelo (429): sus feeds van de uno en uno y con pausa.
const isReddit = (f) => f.url.includes('reddit.com');
const parallel = Promise.all(feeds.filter((f) => !isReddit(f)).map(load));
const serial = [];
for (const f of feeds.filter(isReddit)) {
  serial.push(await load(f));
  await new Promise((r) => setTimeout(r, 2500));
}
const results = [...(await parallel), ...serial];
results.forEach((s, n) => s.items.forEach((i, k) => { i.id = `${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}${k + 1}`; }));

let steamTop = [];
try {
  const j = JSON.parse(await get(steam.featured));
  const pick = (k) => (j[k]?.items ?? []).slice(0, 10).map((g) => ({ name: g.name, discount: g.discount_percent, price: g.final_price / 100, url: `https://store.steampowered.com/app/${g.id}/` }));
  steamTop = { top_sellers: pick('top_sellers'), new_releases: pick('new_releases'), coming_soon: pick('coming_soon') };
  report.push('ok           Steam featured');
} catch (e) { report.push(`FAIL         Steam featured — ${e.message}`); }

await mkdir(path.join(ROOT, 'tmp'), { recursive: true });
const fetchedAt = new Date().toISOString();
await writeFile(path.join(ROOT, 'tmp/headlines.json'), JSON.stringify({ fetchedAt, hours: HOURS, sources: results, steam: steamTop }, null, 1));

// Índice compacto (id + titular) para leer de un tirón; el detalle se pide con --show.
let md = `# Titulares de las últimas ${HOURS} h (descargado ${fetchedAt})\n# Detalle de un titular: node scripts/fetch-feeds.mjs --show ID [ID...]\n`;
for (const kind of ['media', 'official', 'social', 'video']) {
  md += `\n# === ${kind.toUpperCase()} ===\n`;
  for (const s of results.filter((r) => r.kind === kind && r.items.length)) {
    md += `\n## ${s.name} [${s.lang}]\n` + s.items.map((i) => `${i.id} ${i.title}`).join('\n') + '\n';
  }
}
if (steamTop.top_sellers) {
  md += `\n# === STEAM ===\n`;
  for (const [k, list] of Object.entries(steamTop)) md += `\n## ${k}\n` + list.map((g) => `- ${g.name}${g.discount ? ` (-${g.discount}%)` : ''} — ${g.url}`).join('\n') + '\n';
}
await writeFile(path.join(ROOT, 'tmp/headlines.md'), md);

console.log(report.sort().join('\n'));
const total = results.reduce((n, r) => n + r.items.length, 0);
console.log(`\n${total} titulares → tmp/headlines.md, tmp/headlines.json`);
if (total < 20) { console.error('Muy pocos titulares: revisa la red o las fuentes.'); process.exit(1); }
