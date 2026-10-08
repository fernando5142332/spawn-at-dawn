#!/usr/bin/env node
// Busca una imagen para una noticia en fuentes que se pueden usar: arte oficial del juego en Steam,
// miniaturas de vídeos oficiales en YouTube e imágenes con licencia libre de Wikimedia Commons.
// Imprime objetos "image" listos para pegar en la edición. Sin dependencias.
//
//   node scripts/find-image.mjs steam "Dragon's Dogma 2"
//   node scripts/find-image.mjs youtube https://www.youtube.com/watch?v=ID
//   node scripts/find-image.mjs commons "PlayStation VR2"
const [kind, ...rest] = process.argv.slice(2);
const query = rest.join(' ').trim();
const UA = { 'user-agent': 'SpawnAtDawn/1.0 (daily video game news digest)' };
const json = async (url) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`); return r.json(); };
// Una imagen "existe" si responde como imagen y pesa lo bastante: Steam devuelve un marcador de ~2 KB
// en algunas rutas antiguas y Wikimedia rechaza los anchos de miniatura que no son estándar.
const exists = async (url, minBytes = 8000) => {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/') && (await r.arrayBuffer()).byteLength >= minBytes;
  } catch { return false; }
};
const show = (label, image) => console.log(`\n# ${label}\n"image": ${JSON.stringify(image, null, 2)}`);
const text = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

if (!query || !['steam', 'youtube', 'commons'].includes(kind)) {
  console.error('Uso: node scripts/find-image.mjs steam|youtube|commons "<búsqueda o URL>"');
  process.exit(1);
}

if (kind === 'steam') {
  const found = await json(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=es&l=spanish`);
  const apps = (found.items ?? []).filter((i) => i.type === 'app').slice(0, 4);
  if (!apps.length) console.log('Sin resultados en Steam.');
  for (const app of apps) {
    const d = (await json(`https://store.steampowered.com/api/appdetails?appids=${app.id}&l=spanish`))[app.id]?.data;
    if (!d) continue;
    const clean = (u) => u?.split('?')[0];
    const base = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${app.id}`;
    // Arte principal sin logo (library_hero) y cápsula con logo si existen; si no, captura oficial y cabecera.
    const hero = (await exists(`${base}/library_hero.jpg`)) ? `${base}/library_hero.jpg` : clean(d.screenshots?.[0]?.path_full) ?? clean(d.header_image);
    const thumb = (await exists(`${base}/capsule_616x353.jpg`)) ? `${base}/capsule_616x353.jpg` : clean(d.header_image);
    show(`${d.name} · ${d.type} · appid ${app.id} · ${(d.publishers ?? []).join(', ')}`, { url: hero, thumb, credit: `${(d.publishers ?? [d.name])[0]} / Steam`, creditUrl: `https://store.steampowered.com/app/${app.id}/` });
  }
}

if (kind === 'youtube') {
  const id = query.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)?.[1] ?? (/^[\w-]{11}$/.test(query) ? query : null);
  if (!id) { console.error('No reconozco el identificador del vídeo.'); process.exit(1); }
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const meta = await json(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`);
  const url = (await exists(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`)) ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  console.log('Comprueba que el canal es el oficial del juego o de su editora antes de usarla.');
  show(`${meta.title} · canal: ${meta.author_name}`, { url, thumb: url, credit: `${meta.author_name} / YouTube`, creditUrl: watch });
}

if (kind === 'commons') {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1280`;
  const pages = Object.values((await json(api)).query?.pages ?? {}).sort((a, b) => a.index - b.index);
  let shown = 0;
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ?? '';
    // Solo licencias que permiten uso comercial con atribución, y fotos apaisadas con resolución suficiente.
    if (!/^(CC BY(-SA)? \d|CC0|Public domain)/i.test(license) || info.width < 1000 || info.width < info.height * 1.2) continue;
    const url = info.thumburl.split('?')[0];
    if (!(await exists(url)) || !(await exists(url.replace('/1280px-', '/960px-')))) continue;
    // Si el autor indica cómo quiere ser citado (Attribution), manda eso; si no, el campo Artist.
    const author = text(meta.Attribution?.value).split(' / ')[0].trim() || text(meta.Artist?.value).slice(0, 60) || 'Wikimedia Commons';
    show(`${p.title} · ${info.width}×${info.height} · ${license}`, { url, thumb: url.replace('/1280px-', '/960px-'), credit: `${author} / Wikimedia Commons`, creditUrl: info.descriptionurl, license, ...(meta.LicenseUrl?.value ? { licenseUrl: meta.LicenseUrl.value } : {}) });
    if (++shown >= 6) break;
  }
  if (!shown) console.log('Sin resultados con licencia libre en Wikimedia Commons.');
}
