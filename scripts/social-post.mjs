#!/usr/bin/env node
// Publica la edición del día en las redes que tengan credenciales en variables de entorno.
// Sin dependencias. Uso: node scripts/social-post.mjs [--dry-run] [--date AAAA-MM-DD]
//                     node scripts/social-post.mjs --check   (valida las credenciales sin publicar nada)
//                     … --only x                           (limita la ejecución a una red)
//
//   Bluesky   BLUESKY_HANDLE, BLUESKY_APP_PASSWORD
//   Mastodon  MASTODON_URL (https://instancia), MASTODON_TOKEN
//   Telegram  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT (@canal o id)
//   Discord   DISCORD_WEBHOOK
//   Threads   THREADS_TOKEN (token de larga duración de la API de Threads; caduca a los 60 días)
//   X         X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
//
// Las credenciales nunca se guardan en el repositorio: van como "secrets" de GitHub Actions.
import { readFile, readdir } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CHECK = args.includes('--check');
const env = process.env;
const lang = env.SOCIAL_LANG || 'es';
const cfg = JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'));
const SITE = (env.SITE_URL || cfg.siteUrl).replace(/\/$/, '');
const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : (await readdir(path.join(ROOT, 'data/editions'))).filter((f) => f.endsWith('.json')).sort().at(-1).replace('.json', '');
const ed = JSON.parse(await readFile(path.join(ROOT, `data/editions/${date}.json`), 'utf8'));
const pre = lang === 'es' ? '' : `/${lang}`;
const tags = lang === 'es' ? '#videojuegos #gaming' : '#gaming #videogames';

const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`);

// Cada red tiene un límite distinto; urlWeight es lo que "pesa" un enlace (X lo cuenta siempre como 23).
function compose(limit, urlWeight) {
  const top = ed.stories[0];
  const homeUrl = `${SITE}${pre}/`;
  const storyUrl = `${SITE}${pre}/n/${ed.date}/${top.id}/`;
  const w = (url) => urlWeight ?? url.length;

  let bullets = ed.stories.slice(0, 3).map((s) => `▸ ${s.title[lang]}`);
  const head = `🎮 ${ed.headline[lang]}`;
  const digest = () => `${head}\n\n${bullets.join('\n')}\n\n`;
  while (bullets.length && digest().length + w(homeUrl) > limit) bullets = bullets.slice(0, -1);
  const first = bullets.length ? digest() : `${cut(head, limit - w(homeUrl) - 2)}\n\n`;

  const room = limit - w(storyUrl) - tags.length - 4;
  const title = cut(top.title[lang], room);
  const dek = room - title.length > 60 ? `\n\n${cut(top.dek[lang], room - title.length - 2)}` : '';
  return [
    { text: first + homeUrl, url: homeUrl, title: ed.headline[lang], description: ed.intro[lang] },
    { text: `${title}${dek}\n\n${storyUrl}\n${tags}`, url: storyUrl, title: top.title[lang], description: top.dek[lang] },
  ];
}

const get = (url, headers = {}) => json(url, { headers });
const json = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
};
const post = (url, body, headers = {}) => json(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const NETWORKS = {
  bluesky: {
    ready: () => env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD, limit: 300,
    async check() { this.session ??= await post('https://bsky.social/xrpc/com.atproto.server.createSession', { identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }); return `@${this.session.handle}`; },
    async send(p) {
      this.session ??= await post('https://bsky.social/xrpc/com.atproto.server.createSession', { identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD });
      const at = p.text.indexOf(p.url);
      const byteStart = Buffer.byteLength(p.text.slice(0, at));
      await post('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        repo: this.session.did, collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post', text: p.text, langs: [lang], createdAt: new Date().toISOString(),
          facets: [{ index: { byteStart, byteEnd: byteStart + Buffer.byteLength(p.url) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: p.url }] }],
          embed: { $type: 'app.bsky.embed.external', external: { uri: p.url, title: p.title, description: p.description } },
        },
      }, { authorization: `Bearer ${this.session.accessJwt}` });
    },
  },
  mastodon: {
    ready: () => env.MASTODON_URL && env.MASTODON_TOKEN, limit: 500,
    check: async () => `@${(await get(`${env.MASTODON_URL.replace(/\/$/, '')}/api/v1/accounts/verify_credentials`, { authorization: `Bearer ${env.MASTODON_TOKEN}` })).acct}`,
    send: (p) => post(`${env.MASTODON_URL.replace(/\/$/, '')}/api/v1/statuses`, { status: p.text, language: lang, visibility: 'public' }, { authorization: `Bearer ${env.MASTODON_TOKEN}` }),
  },
  telegram: {
    ready: () => env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT, limit: 1000,
    // No basta con que el canal exista: el bot tiene que ser administrador con permiso para publicar.
    async check() {
      const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
      const chat = encodeURIComponent(env.TELEGRAM_CHAT);
      const me = (await get(`${api}/getMe`)).result;
      const member = (await get(`${api}/getChatMember?chat_id=${chat}&user_id=${me.id}`)).result;
      if (member.status !== 'administrator' || member.can_post_messages === false) throw new Error(`el bot @${me.username} no es administrador con permiso de publicar en ${env.TELEGRAM_CHAT}`);
      return `${(await get(`${api}/getChat?chat_id=${chat}`)).result.title}, bot @${me.username}`;
    },
    send: (p) => post(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: env.TELEGRAM_CHAT, text: p.text }),
  },
  discord: {
    ready: () => env.DISCORD_WEBHOOK, limit: 1000,
    check: async () => (await get(env.DISCORD_WEBHOOK)).name,
    send: (p) => post(env.DISCORD_WEBHOOK, { content: p.text, allowed_mentions: { parse: [] } }),
  },
  threads: {
    ready: () => env.THREADS_TOKEN, limit: 500,
    // Además de validar el token, intenta renovarlo e informa de si Threads devuelve el mismo u otro distinto
    // (nunca se imprime el token). Solo se puede renovar un token con más de 24 horas.
    async check() {
      const t = encodeURIComponent(env.THREADS_TOKEN);
      const user = (await get(`https://graph.threads.net/v1.0/me?fields=username&access_token=${t}`)).username;
      let renew;
      try {
        const r = await get(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${t}`);
        renew = `renovación: ${r.access_token === env.THREADS_TOKEN ? 'devuelve el MISMO token' : 'devuelve un token DISTINTO'}, válido ${Math.round(r.expires_in / 86400)} días`;
      } catch (err) { renew = `renovación no disponible ahora: ${err.message.replace(/access_token=[^&"\s]+/g, 'access_token=***').slice(0, 200)}`; }
      return `@${user}; ${renew}`;
    },
    // Threads publica en dos pasos: se crea el contenedor y después se publica.
    async send(p) {
      const api = 'https://graph.threads.net/v1.0/me';
      const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...o, access_token: env.THREADS_TOKEN }) });
      const { id } = await json(`${api}/threads`, form({ media_type: 'TEXT', text: p.text, link_attachment: p.url }));
      await new Promise((r) => setTimeout(r, 4000));
      await json(`${api}/threads_publish`, form({ creation_id: id }));
    },
  },
  x: {
    ready: () => env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET, limit: 280, urlWeight: 23,
    send(p) {
      // OAuth 1.0a: con cuerpo JSON solo se firman los parámetros oauth_*.
      const url = 'https://api.x.com/2/tweets';
      const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      const oauth = { oauth_consumer_key: env.X_API_KEY, oauth_nonce: randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: env.X_ACCESS_TOKEN, oauth_version: '1.0' };
      const params = Object.keys(oauth).sort().map((k) => `${enc(k)}=${enc(oauth[k])}`).join('&');
      oauth.oauth_signature = createHmac('sha1', `${enc(env.X_API_SECRET)}&${enc(env.X_ACCESS_SECRET)}`).update(`POST&${enc(url)}&${enc(params)}`).digest('base64');
      return post(url, { text: p.text }, { authorization: `OAuth ${Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(', ')}` });
    },
  },
};

const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
// Una red puede dejarse en pausa con "autopost": { "x": false } en site.config.json, sin borrar sus claves.
const active = Object.entries(NETWORKS).filter(([name, n]) => (!only || name === only) && cfg.autopost?.[name] !== false && (DRY || n.ready()));
if (!active.length) { console.log('No hay credenciales de ninguna red: no se publica nada.'); process.exit(0); }

if (CHECK) {
  for (const [name, net] of active) {
    if (!net.check) { console.log(`– ${name}: no se puede comprobar sin publicar`); continue; }
    try { console.log(`✔ ${name}: credenciales válidas (${await net.check()})`); } catch (err) { console.error(`✖ ${name}: ${err.message.replace(/bot[^/]+\//, 'bot***/')}`); }
  }
  // La comprobación solo informa: el resultado se lee en el registro y no marca la ejecución como fallida.
  process.exit(0);
}
if (/localhost|127\.0\.0\.1/.test(SITE) && !DRY) { console.error('SITE_URL apunta a localhost: no se publica en redes.'); process.exit(1); }

let failed = 0;
for (const [name, net] of active) {
  const posts = compose(net.limit, net.urlWeight);
  if (DRY) { console.log(`\n── ${name} (límite ${net.limit}) ──`); posts.forEach((p) => console.log(`${p.text}\n[${p.text.length} caracteres]\n`)); continue; }
  for (const p of posts) {
    try { await net.send(p); console.log(`✔ ${name}: ${p.url}`); } catch (err) {
      // Sin saldo en la cuenta de desarrollador de X: se avisa, pero no se da por fallida la publicación del resto.
      if (name === 'x' && /HTTP 402/.test(err.message)) console.log('::warning::X: la cuenta de desarrollador no tiene saldo; no se ha publicado en X.');
      // Bot de Telegram todavía sin permisos en el canal: mismo trato.
      // Token de Threads inválido o caducado (código 190): aviso, sin estropear el resto.
      else if (name === 'threads' && /"code":190/.test(err.message)) console.log('::warning::Threads: el token no es válido o ha caducado; no se ha publicado en Threads.');
      else if (name === 'telegram' && /not a member|administrator rights|not enough rights|chat not found/i.test(err.message)) console.log('::warning::Telegram: el bot aún no es administrador del canal; no se ha publicado en Telegram.');
      else { failed++; console.error(`✖ ${name}: ${err.message}`); }
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
process.exit(failed ? 1 : 0);
