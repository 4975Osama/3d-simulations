/* Video storage for the portal: the files live in a bucket in Neon Object
   Storage (S3-compatible), their details (category, title, size, duration, ...)
   in a Neon Postgres table. Video bytes never pass through this server: it
   hands the admin's browser short-lived signed URLs and the browser uploads
   straight to the bucket, which also keeps uploads working on hosts with small
   request limits. Any S3-compatible store (R2, AWS S3) works the same way. */

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { AwsClient } from 'aws4fetch';

export const CATEGORIES = {
  simex: 'Simex Emergency Videos',
  calendars: 'Hazard Calendars',
  general: 'General Safety Videos',
  simulations2026: '2026 Simulations',
  simulations2027: '2027 Simulations',
};

// videos attached to one hazard site on the map (the popup's video feed) use
// this category plus a site key: "<hazard>:<lng>,<lat>" (4 decimals)
export const SITE_CATEGORY = 'site';
const SITE_KEY_RE = /^[a-z0-9-]{1,40}:-?\d{1,3}\.\d{4},-?\d{1,2}\.\d{4}$/;

export const MAX_VIDEO_BYTES = 4 * 1024 ** 3;    // single-PUT limit is 5 GiB
const MAX_THUMB_BYTES = 2 * 1024 ** 2;
const UPLOAD_URL_S = 60 * 60;                     // signed upload links live an hour
const PLAY_URL_S = 6 * 60 * 60;                   // signed playback links (private bucket)
const EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/ogg': 'ogv' };

export class VideoStoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/* config comes from server/.env; the AWS_* names are the ones Neon's
   Connect -> Storage tab gives, so its snippet can be pasted as is */
export function storageConfigFromEnv(env) {
  return {
    databaseUrl: env.DATABASE_URL,
    endpoint: env.AWS_ENDPOINT_URL_S3,
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    bucket: env.STORAGE_BUCKET || 'portal-videos',
    publicUrl: env.STORAGE_PUBLIC_URL,
  };
}

export function createVideoStore({ databaseUrl, endpoint, region, accessKeyId, secretAccessKey, bucket, publicUrl }) {
  const missing = Object.entries({
    DATABASE_URL: databaseUrl, AWS_ENDPOINT_URL_S3: endpoint, AWS_REGION: region,
    AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { configured: false, missing };

  const sql = neon(databaseUrl);
  const s3 = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });
  // path-style addressing (Neon supports only that): <endpoint>/<bucket>/<key>
  const bucketUrl = `${endpoint.replace(/\/+$/, '')}/${encodeURIComponent(bucket)}`;
  const objectUrl = (key) => `${bucketUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const base = (publicUrl || '').replace(/\/+$/, '');

  async function signed(method, key, seconds) {
    const url = new URL(objectUrl(key));
    url.searchParams.set('X-Amz-Expires', String(seconds));
    const req = await s3.sign(new Request(url, { method }), { aws: { signQuery: true } });
    return req.url;
  }
  // public bucket / custom domain if configured, else a signed link
  const playUrl = (key) => (base ? Promise.resolve(`${base}/${key}`) : signed('GET', key, PLAY_URL_S));

  let ready = null;
  function ensureTable() {
    return ready || (ready = sql`
      CREATE TABLE IF NOT EXISTS videos (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        category    text NOT NULL,
        title       text NOT NULL,
        description text NOT NULL DEFAULT '',
        object_key  text NOT NULL UNIQUE,
        thumb_key   text,
        mime_type   text NOT NULL,
        size_bytes  bigint NOT NULL,
        duration_s  real,
        status      text NOT NULL DEFAULT 'pending',
        created_at  timestamptz NOT NULL DEFAULT now()
      )`.then(() => sql`CREATE INDEX IF NOT EXISTS videos_category_idx ON videos (category, created_at)`)
      .then(() => sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS site_key text`)
      .then(() => sql`CREATE INDEX IF NOT EXISTS videos_site_idx ON videos (site_key) WHERE site_key IS NOT NULL`)
      .catch((err) => { ready = null; throw err; }));
  }

  async function toClient(row) {
    return {
      id: row.id, category: row.category, siteKey: row.site_key || undefined, title: row.title, description: row.description,
      size: Number(row.size_bytes), duration: row.duration_s, createdAt: row.created_at,
      url: await playUrl(row.object_key),
      thumbnail: row.thumb_key ? await playUrl(row.thumb_key) : null,
    };
  }

  async function listVideos() {
    await ensureTable();
    const rows = await sql`SELECT * FROM videos WHERE status = 'ready' ORDER BY created_at`;
    const out = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []]));
    for (const row of rows) if (out[row.category]) out[row.category].push(await toClient(row));
    return out;
  }

  /* map popups: the current video of every hazard site that has one */
  async function listSiteVideos() {
    await ensureTable();
    const rows = await sql`SELECT * FROM videos WHERE category = ${SITE_CATEGORY} AND status = 'ready' ORDER BY created_at`;
    const out = {};
    for (const row of rows) out[row.site_key] = await toClient(row);   // newest wins
    return out;
  }

  /* step 1: record the video as pending and return where to PUT its bytes */
  async function startUpload({ category, siteKey, title, description, mimeType, size }) {
    if (category === SITE_CATEGORY) {
      if (!SITE_KEY_RE.test(siteKey || '')) throw new VideoStoreError('Unknown map site.');
    } else if (!Object.hasOwn(CATEGORIES, category)) throw new VideoStoreError('Unknown video category.');
    if (!title) throw new VideoStoreError('Give the video a title.');
    if (title.length > 100) throw new VideoStoreError('Title must be 100 characters or fewer.');
    if (description.length > 5000) throw new VideoStoreError('Description is too long (5000 characters max).');
    if (!/^video\//.test(mimeType)) throw new VideoStoreError('Only video files can be uploaded.');
    if (!(size > 0)) throw new VideoStoreError('The video file is empty.');
    if (size > MAX_VIDEO_BYTES) throw new VideoStoreError('Video is larger than the 4 GB limit.', 413);
    await ensureTable();
    const id = crypto.randomUUID();
    const key = `videos/${category}/${id}.${EXT[mimeType] || 'mp4'}`;
    const thumbKey = `videos/${category}/${id}.jpg`;
    const site = category === SITE_CATEGORY ? siteKey : null;
    await sql`INSERT INTO videos (id, category, site_key, title, description, object_key, mime_type, size_bytes)
              VALUES (${id}, ${category}, ${site}, ${title}, ${description}, ${key}, ${mimeType}, ${size})`;
    return { id, uploadUrl: await signed('PUT', key, UPLOAD_URL_S), thumbUploadUrl: await signed('PUT', thumbKey, UPLOAD_URL_S) };
  }

  async function head(key) {
    const res = await s3.fetch(objectUrl(key), { method: 'HEAD' });
    return res.ok ? Number(res.headers.get('content-length')) : null;
  }

  /* step 2: after the browser's PUT, check the bucket really has it, then publish */
  async function finishUpload(id, { duration, hasThumb }) {
    await ensureTable();
    const [row] = await sql`SELECT * FROM videos WHERE id = ${id}`;
    if (!row) throw new VideoStoreError('Unknown upload.', 404);
    if (row.status === 'ready') return toClient(row);
    const size = await head(row.object_key);
    if (size == null) throw new VideoStoreError('The video never reached storage — try the upload again.', 409);
    if (size > MAX_VIDEO_BYTES) {
      await remove(id);
      throw new VideoStoreError('Video is larger than the 4 GB limit.', 413);
    }
    const thumbKey = row.object_key.replace(/\.[^.]+$/, '.jpg');
    const thumbSize = hasThumb ? await head(thumbKey) : null;
    if (thumbSize != null && thumbSize > MAX_THUMB_BYTES) await s3.fetch(objectUrl(thumbKey), { method: 'DELETE' });
    const dur = Number.isFinite(duration) && duration > 0 ? duration : null;
    const [done] = await sql`UPDATE videos SET status = 'ready', size_bytes = ${size}, duration_s = ${dur},
                               thumb_key = ${thumbSize != null && thumbSize <= MAX_THUMB_BYTES ? thumbKey : null}
                             WHERE id = ${id} RETURNING *`;
    if (done.site_key) {   // a site shows one video: the new one replaces the old (and frees its storage)
      const old = await sql`SELECT id FROM videos WHERE site_key = ${done.site_key} AND id <> ${id}`;
      for (const o of old) await remove(o.id).catch((err) => console.warn('[videos] old site video:', err.message));
    }
    return toClient(done);
  }

  async function remove(id) {
    await ensureTable();
    const [row] = await sql`SELECT object_key, thumb_key FROM videos WHERE id = ${id}`;
    if (!row) throw new VideoStoreError('Video not found.', 404);
    for (const key of [row.object_key, row.thumb_key].filter(Boolean)) {
      const res = await s3.fetch(objectUrl(key), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new VideoStoreError(`Couldn't delete the file from storage (HTTP ${res.status}).`, 502);
    }
    await sql`DELETE FROM videos WHERE id = ${id}`;
  }

  /* one-time setup: table, bucket, and CORS rules so browsers on these
     origins may PUT/GET. Returns notes for the setup script to print. */
  async function setup(origins) {
    const notes = [];
    await ensureTable();
    notes.push('Neon database: videos table ready.');
    const head = await s3.fetch(bucketUrl, { method: 'HEAD' });
    if (head.status === 404) {
      const made = await s3.fetch(bucketUrl, { method: 'PUT' });
      if (!made.ok) throw new VideoStoreError(`Couldn't create bucket "${bucket}" (HTTP ${made.status}): ${(await made.text()).slice(0, 300)}`, 502);
      notes.push(`Storage: created private bucket "${bucket}".`);
    } else if (head.ok) {
      notes.push(`Storage: bucket "${bucket}" found.`);
    } else {
      throw new VideoStoreError(`Can't reach bucket "${bucket}" (HTTP ${head.status}) — check the AWS_* keys in server/.env.`, 502);
    }
    const xml = '<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration><CORSRule>'
      + origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join('')
      + '<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod>'
      + '<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds>'
      + '</CORSRule></CORSConfiguration>';
    const res = await s3.fetch(`${bucketUrl}?cors`, {
      method: 'PUT', body: xml,
      headers: { 'Content-Type': 'application/xml', 'Content-MD5': crypto.createHash('md5').update(xml).digest('base64') },
    });
    if (!res.ok) throw new VideoStoreError(`The bucket refused the CORS rules (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`, 502);
    notes.push(`Storage: browsers on ${origins.join(', ')} may upload and play videos.`);
    return notes;
  }

  return { configured: true, listVideos, listSiteVideos, startUpload, finishUpload, remove, setup };
}
