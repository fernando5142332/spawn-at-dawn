#!/usr/bin/env node
// Avisa a los buscadores compatibles con IndexNow (Bing, Yandex, Seznam, Naver…) de las páginas nuevas.
// La clave es pública por diseño: el sitio la sirve en /<clave>.txt. Hay que ejecutar build antes.
// Uso: SITE_URL=https://… node scripts/indexnow.mjs --date AAAA-MM-DD | --all
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE = (process.env.SITE_URL || cfg.siteUrl).replace(/\/$/, '');
const args = process.argv.slice(2);
const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : '';

if (!cfg.indexNowKey || /localhost|127\.0\.0\.1/.test(SITE)) { console.log('Sin clave IndexNow o sitio local: no se envía nada.'); process.exit(0); }
const all = [...(await readFile(path.join(ROOT, 'dist/sitemap.xml'), 'utf8')).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+(?=\/|$)/, new URL(SITE).origin));
// Con --date: las páginas de esa edición más las portadas y archivos, que cambian con cada edición.
const urlList = args.includes('--all') ? all : all.filter((u) => u.includes(`/${date}/`) || /\/(en\/)?((archivo|archive)\/)?$/.test(new URL(u).pathname));
if (!urlList.length) { console.log('No hay direcciones que enviar.'); process.exit(0); }

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(SITE).host, key: cfg.indexNowKey, keyLocation: `${SITE}/${cfg.indexNowKey}.txt`, urlList }),
  signal: AbortSignal.timeout(20000),
});
console.log(`IndexNow: ${urlList.length} direcciones → HTTP ${res.status}`);
process.exit(res.ok ? 0 : 1);
