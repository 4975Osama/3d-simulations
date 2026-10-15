/* Portal server: serves portal/ and uploads the video pages' videos to the
   YouTube channel. Google credentials live only here (server/.env) — the
   browser just calls /api/*, and uploading requires the admin login. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { CATEGORIES, YouTubeError, createYouTube } from './youtube.js';

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
const PRIVACY = ['public', 'unlisted', 'private'].includes(env.YOUTUBE_PRIVACY) ? env.YOUTUBE_PRIVACY : 'unlisted';

const youtube = createYouTube({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  refreshToken: env.YOUTUBE_REFRESH_TOKEN,
  privacy: PRIVACY,
  tokenUrl: env.GOOGLE_OAUTH_TOKEN_URL,
  apiBase: env.GOOGLE_API_BASE,
});

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
  res.status(401).json({ error: 'Log in as admin to upload videos.' });
}

function requireYouTube(req, res, next) {
  if (youtube.configured) return next();
  res.status(503).json({ error: 'YouTube isn\'t connected — add your Google credentials to server/.env.' });
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
  res.json({ admin: isAdmin(req), loginEnabled: Boolean(ADMIN_PASSWORD), youtubeConfigured: youtube.configured });
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

app.get('/api/youtube/auth', (req, res) => {
  const clientId = env.GOOGLE_CLIENT_ID;
  const redirectUri = env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/api/youtube/auth/callback';
  if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID is not configured in server/.env');
  
  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.readonly'
  ].join(' ');

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
  res.redirect(url);
});

app.get('/api/youtube/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code provided');

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/api/youtube/auth/callback';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.refresh_token) {
      return res.status(400).send(`Failed to get refresh token: ${tokens.error_description || tokens.error || 'No refresh token returned (try revoking app permissions in Google Account first)'}`);
    }

    process.env.YOUTUBE_REFRESH_TOKEN = tokens.refresh_token;

    // Save to server/.env
    const envPath = path.join(here, '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (envContent.includes('YOUTUBE_REFRESH_TOKEN=')) {
      envContent = envContent.replace(/YOUTUBE_REFRESH_TOKEN=.*/, `YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      envContent += `\nYOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');

    // Save to youtube-app/.yt-tokens.json
    try {
      const ytTokenFile = path.resolve(here, '../youtube-app/.yt-tokens.json');
      fs.writeFileSync(ytTokenFile, JSON.stringify({ refresh_token: tokens.refresh_token, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    } catch { /* ignore */ }

    listCache = null;
    res.send('<h2>YouTube Connected Successfully!</h2><p>You can close this tab and return to the <a href="/portal/">3D Simulation Portal</a>.</p>');
  } catch (err) {
    res.status(500).send(`OAuth Error: ${err.message}`);
  }
});

// Listing is public (every visitor sees the videos) — cached so page views
// don't each spend API quota.
const LIST_CACHE_MS = 60 * 1000;
let listCache = null;

app.get('/api/videos', async (req, res) => {
  if (!youtube.configured) {
    return res.json({ configured: false, videos: Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []])) });
  }
  try {
    if (!listCache || Date.now() - listCache.at > LIST_CACHE_MS) {
      listCache = { at: Date.now(), videos: await youtube.listVideos() };
    }
    return res.json({ configured: true, videos: listCache.videos });
  } catch (err) {
    console.warn('YouTube API error:', err.message);
    return res.json({
      configured: false,
      error: err.message,
      videos: Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []])),
    });
  }
});


const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 4 * 1024 ** 3, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    const isVideo = file.mimetype.startsWith('video/');
    if (!isVideo) req.rejectedUpload = true;
    cb(null, isVideo);
  },
});

// admin + config checks run before multer so a rejected request never writes
// its (possibly multi-GB) body to disk
app.post('/api/videos', requireAdmin, requireYouTube, upload.single('video'), async (req, res) => {
  const file = req.file;
  try {
    if (req.rejectedUpload) return res.status(400).json({ error: 'Only video files can be uploaded.' });
    if (!file) return res.status(400).json({ error: 'Choose a video file to upload.' });

    const category = String(req.body.category || '');
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();

    if (!Object.hasOwn(CATEGORIES, category)) return res.status(400).json({ error: 'Unknown video category.' });
    // YouTube rejects titles/descriptions containing angle brackets
    if (!title) return res.status(400).json({ error: 'Give the video a title.' });
    if (title.length > 100) return res.status(400).json({ error: 'Title must be 100 characters or fewer.' });
    if (/[<>]/.test(title) || /[<>]/.test(description)) {
      return res.status(400).json({ error: 'Title and description can\'t contain < or > characters.' });
    }
    if (Buffer.byteLength(description) > 5000) return res.status(400).json({ error: 'Description is too long (5000 bytes max).' });

    const video = await youtube.uploadVideo({
      category, title, description, filePath: file.path, mimeType: file.mimetype, size: file.size,
    });
    listCache = null;
    res.status(201).json({ video });
  } catch (err) {
    console.error('Upload error:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Upload failed.' });
  } finally {
    if (file) fs.rm(file.path, { force: true }, () => {});
  }
});


app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Video is larger than the 4 GB limit.' : err.message });
  }
  if (err instanceof YouTubeError) return res.status(502).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, HOST, () => {
  console.log(`3D Simulation Portal → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/portal/`);
  if (!youtube.configured) {
    console.warn('YouTube not connected: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in server/.env');
  }
  if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD not set: video uploads are disabled.');
  else if (ADMIN_PASSWORD.length < 12) {
    console.warn('ADMIN_PASSWORD is short: anyone who can reach this server could guess it and post to your channel.');
  }
});
