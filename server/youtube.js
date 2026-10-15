/* YouTube Data API client for the portal. Holds the channel's refresh token
   server-side only, and keeps one playlist per video category. Talks to the
   REST API directly (no googleapis SDK) — the surface used is small. */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const CATEGORIES = {
  simex: 'Simex Emergency Videos',
  calendars: 'Hazard Calendars',
  general: 'General Safety Videos',
  simulations2026: '2026 Simulations',
  simulations2027: '2027 Simulations',
};

const EDUCATION_CATEGORY_ID = '27';

export class YouTubeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createYouTube({
  clientId, clientSecret, refreshToken, privacy,
  tokenUrl = 'https://oauth2.googleapis.com/token',
  apiBase = 'https://www.googleapis.com',
}) {
  function getActiveRefreshToken() {
    if (process.env.YOUTUBE_REFRESH_TOKEN) return process.env.YOUTUBE_REFRESH_TOKEN.trim();

    for (const candidate of [
      path.resolve(here, '.env'),
      path.resolve(here, '../youtube-app/.env.local'),
      path.resolve(here, '../youtube-app/.yt-tokens.json'),
    ]) {
      try {
        if (!fs.existsSync(candidate)) continue;

        if (candidate.endsWith('.json')) {
          const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (data.refresh_token) return String(data.refresh_token).trim();
          continue;
        }

        const envContent = fs.readFileSync(candidate, 'utf8');
        const match = envContent.match(/(?:^|\n)YOUTUBE_REFRESH_TOKEN=(.*?)(?:\n|$)/);
        if (match && match[1].trim()) return match[1].trim().replace(/^['"]|['"]$/g, '');
      } catch { /* ignore */ }
    }

    return refreshToken ? String(refreshToken).trim() : '';
  }

  const isConfigured = () => Boolean(clientId && clientSecret && getActiveRefreshToken());
  let token = null;

  async function accessToken() {
    const activeToken = getActiveRefreshToken();
    if (!activeToken) {
      throw new YouTubeError('YouTube is not connected — no refresh token found.', 401);
    }
    if (token && Date.now() < token.expiresAt) return token.value;

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: activeToken,
        grant_type: 'refresh_token',
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = body.error === 'invalid_grant'
        ? 'the refresh token was rejected (revoked or expired) — generate a new YOUTUBE_REFRESH_TOKEN'
        : body.error_description || body.error || `HTTP ${res.status}`;
      throw new YouTubeError(`YouTube sign-in failed: ${reason}`, res.status);
    }
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  async function api(method, url, body) {
    const res = await fetch(`${apiBase}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new YouTubeError(apiErrorMessage(data, res.status), res.status);
    return data;
  }

  async function listAll(url) {
    const items = [];
    let pageToken = '';
    do {
      const page = await api('GET', `${url}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`);
      items.push(...(page.items || []));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return items;
  }

  const playlistIds = {};
  const creating = {};

  // Only looks playlists up — listing must never create anything on the
  // channel, since any portal visitor can trigger it.
  async function findPlaylistIds() {
    const mine = await listAll('/youtube/v3/playlists?part=snippet&mine=true');
    for (const [key, title] of Object.entries(CATEGORIES)) {
      const match = mine.find((p) => p.snippet?.title === title);
      if (match) playlistIds[key] = match.id;
    }
    return { ...playlistIds };
  }

  async function ensurePlaylistId(key) {
    if (playlistIds[key]) return playlistIds[key];
    // one in-flight creation per category, so two concurrent first uploads
    // don't create duplicate playlists
    creating[key] ??= (async () => {
      const found = await findPlaylistIds();
      if (found[key]) return found[key];
      const created = await api('POST', '/youtube/v3/playlists?part=snippet,status', {
        snippet: { title: CATEGORIES[key], description: `3D Simulation Portal — ${CATEGORIES[key]}` },
        status: { privacyStatus: privacy },
      });
      playlistIds[key] = created.id;
      return created.id;
    })().finally(() => { delete creating[key]; });
    return creating[key];
  }

  async function listVideos() {
    const ids = await findPlaylistIds();
    const out = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []]));
    await Promise.all(Object.entries(ids).map(async ([key, playlistId]) => {
      const items = await listAll(`/youtube/v3/playlistItems?part=snippet,status&playlistId=${encodeURIComponent(playlistId)}`);
      out[key] = items
        .filter((it) => it.snippet?.resourceId?.videoId)
        .map((it) => ({
          id: it.snippet.resourceId.videoId,
          title: it.snippet.title,
          description: it.snippet.description || '',
          thumbnail: bestThumbnail(it.snippet.thumbnails),
          privacy: it.status?.privacyStatus || 'public',
        }));
    }));
    return out;
  }

  async function uploadVideo({ category, title, description, filePath, mimeType, size }) {
    const playlistId = await ensurePlaylistId(category);
    const auth = await accessToken();

    const init = await fetch(`${apiBase}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify({
        snippet: { title, description, categoryId: EDUCATION_CATEGORY_ID },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      }),
    });
    if (!init.ok) {
      const data = await init.json().catch(() => ({}));
      throw new YouTubeError(apiErrorMessage(data, init.status), init.status);
    }
    const sessionUrl = init.headers.get('location');
    if (!sessionUrl) throw new YouTubeError('YouTube did not return an upload session URL.', 502);

    const video = await putFile(sessionUrl, filePath, size, mimeType, auth);

    try {
      await api('POST', '/youtube/v3/playlistItems?part=snippet', {
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId: video.id } },
      });
    } catch (err) {
      throw new YouTubeError(
        `Video uploaded (id ${video.id}) but couldn't be added to the "${CATEGORIES[category]}" playlist: ${err.message}`,
        err.status,
      );
    }

    return {
      id: video.id,
      title: video.snippet?.title ?? title,
      description: video.snippet?.description ?? description,
      thumbnail: bestThumbnail(video.snippet?.thumbnails),
      privacy: video.status?.privacyStatus || privacy,
    };
  }

  return {
    get configured() { return isConfigured(); },
    listVideos,
    uploadVideo,
  };

}

// Streamed with node:http(s) rather than fetch so the file is piped from disk
// with an explicit Content-Length (large videos never sit in memory).
function putFile(url, filePath, size, mimeType, auth) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(target, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Length': size, 'Content-Type': mimeType },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = JSON.parse(raw); } catch { /* non-JSON error body */ }
        if (res.statusCode >= 200 && res.statusCode < 300 && data.id) resolve(data);
        else reject(new YouTubeError(apiErrorMessage(data, res.statusCode), res.statusCode));
      });
    });
    req.on('error', (err) => reject(new YouTubeError(`Upload to YouTube failed: ${err.message}`, 502)));
    fs.createReadStream(filePath)
      .on('error', (err) => { req.destroy(); reject(err); })
      .pipe(req);
  });
}

function apiErrorMessage(data, status) {
  const reason = data.error?.errors?.[0]?.reason;
  const message = data.error?.message || '';
  if (reason === 'quotaExceeded') return 'YouTube daily API quota is used up — try again tomorrow.';
  if (reason === 'insufficientPermissions' || /insufficient authentication scopes/i.test(message)) {
    return 'YouTube refused the request: the refresh token needs the full "youtube" scope '
      + '(youtube.upload alone can\'t manage playlists). Generate a new token with that scope.';
  }
  return message || `YouTube API error (HTTP ${status})`;
}

function bestThumbnail(thumbnails = {}) {
  return (thumbnails.high || thumbnails.medium || thumbnails.default || {}).url || '';
}
