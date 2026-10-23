/* Portal server: serves portal/ and manages the video pages' videos — files
   in a Neon Object Storage bucket, details in a Neon Postgres table. Their keys live
   only here (server/.env); the browser just calls /api/*, and adding or
   deleting videos requires the admin login. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { CATEGORIES, createVideoStore, storageConfigFromEnv, VideoStoreError } from './videostore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const PORT = Number(env.PORT) || 8080;
const HOST = env.HOST || '127.0.0.1';
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';
// Unset → random per start: sessions just don't survive a restart.
const AUTH_SECRET = env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

const videos = createVideoStore(storageConfigFromEnv(env));

const app = express();
app.disable('x-powered-by');

/* ---------------------------------------------------------------- static
   Explicit allowlist: portal/ plus the water engine it imports from the repo
   root. Nothing else under the repo (server/.env, .git, data/) is reachable. */
app.get('/', (req, res) => res.redirect('/portal/'));
app.use('/portal', express.static(path.join(root, 'portal')));
app.get('/waterSurface.js', (req, res) => res.sendFile(path.join(root, 'waterSurface.js')));
app.get('/bg-video.mp4', (req, res) => res.sendFile(path.join(root, 'bg video.mp4')));

/* ---------------------------------------------------------------- admin session */
const COOKIE = 'portal_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;

const sign = (value) => crypto.createHmac('sha256', AUTH_SECRET).update(value).digest('base64url');
const digest = (value) => crypto.createHash('sha256').update(value).digest();

function readCookie(req, name) {
  const pair = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
}

function isAdmin(req) {
  const [expires, mac] = readCookie(req, COOKIE).split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  const given = Buffer.from(mac);
  const expected = Buffer.from(sign(expires));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Log in as admin to manage videos.' });
}

function requireStorage(req, res, next) {
  if (videos.configured) return next();
  res.status(503).json({ error: `Video storage isn't set up — add ${videos.missing.join(', ')} to server/.env.` });
}

/* ---------------------------------------------------------------- OSM buildings
   Digital Twin city mode: proxies one bbox of OpenStreetMap building footprints
   from Overpass, converts them to GeoJSON and caches the result on disk, so
   each area only hits the public Overpass API once. */
const OSM_CACHE = path.join(here, 'cache', 'osm-buildings');
const OVERPASS_URL = env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const osmPending = new Map();

async function fetchOsmBuildings([s, w, n, e], file) {
  const query = `[out:json][timeout:60];way["building"](${s},${w},${n},${e});out tags geom;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': '3d-simulation-portal/1.0' },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const { elements = [] } = await res.json();
  const features = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
    const ring = el.geometry.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]);
    const t = el.tags || {};
    const h = parseFloat(t.height) || (parseFloat(t['building:levels']) * 3.2) || 7;
    features.push({ type: 'Feature', id: features.length + 1, properties: { h: Math.min(300, h) }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  fs.mkdirSync(OSM_CACHE, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ type: 'FeatureCollection', features }));
  fs.renameSync(file + '.tmp', file);
}

app.get('/api/osm-buildings', async (req, res, next) => {
  const b = ['s', 'w', 'n', 'e'].map((k) => Number(req.query[k]));
  const [s, w, n, e] = b;
  if (b.some((v) => !Number.isFinite(v)) || n <= s || e <= w || n - s > 0.12 || e - w > 0.15 || Math.abs(s) > 85 || Math.abs(n) > 85) {
    return res.status(400).json({ error: 'Invalid bbox.' });
  }
  const key = b.map((v) => v.toFixed(3)).join('_');
  const file = path.join(OSM_CACHE, `${key}.json`);
  try {
    if (!fs.existsSync(file)) {
      if (!osmPending.has(key)) osmPending.set(key, fetchOsmBuildings(b, file).finally(() => osmPending.delete(key)));
      await osmPending.get(key);
    }
    res.type('json').sendFile(file);
  } catch (err) {
    console.warn('[osm-buildings]', err.message);
    res.status(502).json({ error: 'OpenStreetMap buildings unavailable right now.' });
  }
});

/* ---------------------------------------------------------------- api */
app.get('/api/session', (req, res) => {
  res.json({ admin: isAdmin(req), loginEnabled: Boolean(ADMIN_PASSWORD), storageConfigured: videos.configured });
});

app.post('/api/login', express.json(), async (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin login is disabled — set ADMIN_PASSWORD in server/.env.' });
  }
  const ok = crypto.timingSafeEqual(digest(String(req.body?.password ?? '')), digest(ADMIN_PASSWORD));
  if (!ok) {
    await new Promise((resolve) => setTimeout(resolve, 700));   // slows password guessing
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const expires = String(Date.now() + SESSION_MS);
  res.cookie(COOKIE, `${expires}.${sign(expires)}`, {
    httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_MS, path: '/',
  });
  res.json({ admin: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ admin: false });
});

// Listing is public (every visitor sees the videos) — cached briefly so page
// views don't each query the database.
const LIST_CACHE_MS = 60 * 1000;
let listCache = null;
const emptyList = () => Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []]));

app.get('/api/videos', async (req, res) => {
  if (!videos.configured) return res.json({ configured: false, videos: emptyList() });
  try {
    if (!listCache || Date.now() - listCache.at > LIST_CACHE_MS) listCache = { at: Date.now(), videos: await videos.listVideos() };
    return res.json({ configured: true, videos: listCache.videos });
  } catch (err) {
    console.warn('Video list error:', err.message);
    return res.json({ configured: true, error: "Couldn't reach the video database.", videos: emptyList() });
  }
});

// the map's hazard popups: one video per site, keyed "<hazard>:<lng>,<lat>"
let siteCache = null;
app.get('/api/site-videos', async (req, res) => {
  if (!videos.configured) return res.json({ configured: false, videos: {} });
  try {
    if (!siteCache || Date.now() - siteCache.at > LIST_CACHE_MS) siteCache = { at: Date.now(), videos: await videos.listSiteVideos() };
    return res.json({ configured: true, videos: siteCache.videos });
  } catch (err) {
    console.warn('Site video list error:', err.message);
    return res.json({ configured: true, error: "Couldn't reach the video database.", videos: {} });
  }
});

/* adding a video: 1) get signed upload links, 2) the browser PUTs the file (and
   a thumbnail) straight to the bucket, 3) confirm, and the server publishes the row */
app.post('/api/videos', requireAdmin, requireStorage, express.json(), async (req, res, next) => {
  try {
    const b = req.body || {};
    const upload = await videos.startUpload({
      category: String(b.category || ''), siteKey: String(b.siteKey || ''), title: String(b.title || '').trim(),
      description: String(b.description || '').trim(), mimeType: String(b.mimeType || ''), size: Number(b.size),
    });
    res.status(201).json(upload);
  } catch (err) { next(err); }
});

app.post('/api/videos/:id/complete', requireAdmin, requireStorage, express.json(), async (req, res, next) => {
  try {
    const video = await videos.finishUpload(req.params.id, { duration: Number(req.body?.duration), hasThumb: Boolean(req.body?.hasThumb) });
    listCache = null; siteCache = null;
    res.json({ video });
  } catch (err) { next(err); }
});

app.delete('/api/videos/:id', requireAdmin, requireStorage, async (req, res, next) => {
  try {
    await videos.remove(req.params.id);
    listCache = null; siteCache = null;
    res.json({ deleted: true });
  } catch (err) { next(err); }
});


app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof VideoStoreError) return res.status(err.status).json({ error: err.message });
  // a malformed id reaching Postgres' uuid column
  if (/invalid input syntax for type uuid/.test(err.message)) return res.status(404).json({ error: 'Video not found.' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, HOST, () => {
  console.log(`3D Simulation Portal → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/portal/`);
  if (!videos.configured) console.warn(`Video storage not set up: add ${videos.missing.join(', ')} to server/.env, then run npm run setup`);
  if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD not set: video uploads are disabled.');
  else if (ADMIN_PASSWORD.length < 12) {
    console.warn('ADMIN_PASSWORD is short: anyone who can reach this server could guess it and change your videos.');
  }
});
