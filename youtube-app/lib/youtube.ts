/**
 * YouTube Data API v3 wrapper — server-side only.
 *
 * All calls use the authorized OAuth2 client from lib/google-auth.ts,
 * which holds the channel owner's refresh token. The browser never
 * touches Google APIs directly.
 *
 * ── Serverless limits ───────────────────────────────────────────────────
 * Resumable uploads stream the video body through the server. On
 * serverless platforms (Vercel, Netlify Functions) the request timeout
 * is typically 10–60 s, which is too short for videos > ~50 MB.
 * For production with large files, use a long-lived Node.js host
 * (VPS, Docker, Railway, Fly.io, etc.).
 * ────────────────────────────────────────────────────────────────────────
 */

import { google, youtube_v3 } from 'googleapis';
import { Readable } from 'node:stream';
import { authorizedClient } from './google-auth';

// ── Video categories (matching the existing project) ────────────────────────
export const CATEGORIES: Record<string, string> = {
  simex: 'Simex Emergency Videos',
  calendars: 'Hazard Calendars',
  general: 'General Safety Videos',
};

// YouTube "Education" category — used for all uploads
const EDUCATION_CATEGORY_ID = '27';

// ── Error handling ──────────────────────────────────────────────────────────

/**
 * Normalized YouTube API error.
 * Wraps all errors from the YouTube Data API into a consistent shape.
 */
export class YouTubeApiError extends Error {
  status: number;
  reason: string;

  constructor(message: string, status = 500, reason = 'unknown') {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Extracts a human-readable message from a YouTube API error response.
 */
function normalizeApiError(err: unknown): YouTubeApiError {
  // googleapis wraps errors in a GaxiosError with response.data
  const error = err as {
    response?: { status?: number; data?: { error?: { errors?: Array<{ reason?: string; message?: string }>; message?: string } } };
    message?: string;
    code?: number;
  };

  const status = error.response?.status ?? error.code ?? 500;
  const apiErrors = error.response?.data?.error?.errors ?? [];
  const reason = apiErrors[0]?.reason ?? 'unknown';
  const apiMessage = error.response?.data?.error?.message ?? error.message ?? '';

  // Friendly messages for common errors
  if (reason === 'quotaExceeded') {
    return new YouTubeApiError(
      'YouTube daily API quota is used up — try again tomorrow.',
      403,
      reason
    );
  }
  if (
    reason === 'insufficientPermissions' ||
    /insufficient authentication scopes/i.test(apiMessage)
  ) {
    return new YouTubeApiError(
      'YouTube refused the request: the refresh token needs the full "youtube" scope ' +
        "(youtube.upload alone can't manage playlists). Generate a new token with that scope.",
      403,
      reason
    );
  }
  if (reason === 'forbidden' || status === 403) {
    return new YouTubeApiError(
      `YouTube access denied: ${apiMessage || 'check channel permissions.'}`,
      403,
      reason
    );
  }

  return new YouTubeApiError(
    apiMessage || `YouTube API error (HTTP ${status})`,
    Number(status),
    reason
  );
}

// ── Client factory ──────────────────────────────────────────────────────────

function getYouTubeClient(): youtube_v3.Youtube {
  return google.youtube({ version: 'v3', auth: authorizedClient() });
}

// ── Channel info ────────────────────────────────────────────────────────────

export interface ChannelInfo {
  id: string;
  title: string;
  thumbnail: string;
  uploadsPlaylistId: string;
}

/**
 * Fetches the authenticated user's YouTube channel info.
 * Validates that the account actually has a channel and upload capability.
 */
export async function getChannelInfo(): Promise<ChannelInfo> {
  try {
    const yt = getYouTubeClient();
    const res = await yt.channels.list({
      part: ['snippet', 'contentDetails'],
      mine: true,
    });

    const channel = res.data.items?.[0];
    if (!channel) {
      throw new YouTubeApiError(
        'This Google account has no YouTube channel. Create one at youtube.com first.',
        404,
        'noChannel'
      );
    }

    const thumbnails = channel.snippet?.thumbnails ?? {};
    const thumb =
      thumbnails.high?.url ??
      thumbnails.medium?.url ??
      thumbnails.default?.url ??
      '';

    return {
      id: channel.id!,
      title: channel.snippet?.title ?? 'Unknown Channel',
      thumbnail: thumb,
      uploadsPlaylistId:
        channel.contentDetails?.relatedPlaylists?.uploads ?? '',
    };
  } catch (err) {
    if (err instanceof YouTubeApiError) throw err;
    throw normalizeApiError(err);
  }
}

// ── Playlist management ─────────────────────────────────────────────────────

const playlistCache: Record<string, string> = {};
const creatingPlaylist: Record<string, Promise<string>> = {};

/**
 * Finds existing playlists that match our category titles.
 */
async function findPlaylistIds(): Promise<Record<string, string>> {
  try {
    const yt = getYouTubeClient();
    const items: youtube_v3.Schema$Playlist[] = [];
    let pageToken: string | undefined;

    do {
      const res = await yt.playlists.list({
        part: ['snippet'],
        mine: true,
        maxResults: 50,
        pageToken,
      });
      items.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    for (const [key, title] of Object.entries(CATEGORIES)) {
      const match = items.find((p) => p.snippet?.title === title);
      if (match?.id) playlistCache[key] = match.id;
    }

    return { ...playlistCache };
  } catch (err) {
    throw normalizeApiError(err);
  }
}

/**
 * Returns the playlist ID for a category, creating the playlist if needed.
 * Concurrent first-uploads for the same category share one creation promise
 * to avoid duplicates.
 */
async function ensurePlaylistId(
  category: string,
  privacy: string
): Promise<string> {
  if (playlistCache[category]) return playlistCache[category];

  // Deduplicate concurrent creates
  if (!creatingPlaylist[category]) {
    creatingPlaylist[category] = (async () => {
      const found = await findPlaylistIds();
      if (found[category]) return found[category];

      try {
        const yt = getYouTubeClient();
        const res = await yt.playlists.insert({
          part: ['snippet', 'status'],
          requestBody: {
            snippet: {
              title: CATEGORIES[category],
              description: `3D Simulation Portal — ${CATEGORIES[category]}`,
            },
            status: {
              privacyStatus: privacy,
            },
          },
        });
        const id = res.data.id!;
        playlistCache[category] = id;
        return id;
      } catch (err) {
        throw normalizeApiError(err);
      }
    })().finally(() => {
      delete creatingPlaylist[category];
    });
  }

  return creatingPlaylist[category];
}

// ── Video listing ───────────────────────────────────────────────────────────

export interface VideoItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  privacy: string;
}

/**
 * Lists all videos across category playlists.
 * Returns an object keyed by category name.
 */
export async function listVideos(): Promise<Record<string, VideoItem[]>> {
  try {
    const ids = await findPlaylistIds();
    const result: Record<string, VideoItem[]> = {};

    for (const key of Object.keys(CATEGORIES)) {
      result[key] = [];
    }

    await Promise.all(
      Object.entries(ids).map(async ([key, playlistId]) => {
        const yt = getYouTubeClient();
        const items: youtube_v3.Schema$PlaylistItem[] = [];
        let pageToken: string | undefined;

        do {
          const res = await yt.playlistItems.list({
            part: ['snippet', 'status'],
            playlistId,
            maxResults: 50,
            pageToken,
          });
          items.push(...(res.data.items ?? []));
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);

        result[key] = items
          .filter((it) => it.snippet?.resourceId?.videoId)
          .map((it) => {
            const thumbnails = it.snippet?.thumbnails ?? {};
            return {
              id: it.snippet!.resourceId!.videoId!,
              title: it.snippet?.title ?? '',
              description: it.snippet?.description ?? '',
              thumbnail:
                thumbnails.high?.url ??
                thumbnails.medium?.url ??
                thumbnails.default?.url ??
                '',
              privacy: it.status?.privacyStatus ?? 'public',
            };
          });
      })
    );

    return result;
  } catch (err) {
    if (err instanceof YouTubeApiError) throw err;
    throw normalizeApiError(err);
  }
}

// ── Video upload ────────────────────────────────────────────────────────────

export interface UploadParams {
  /** Readable stream of the video file body — piped directly, never stored. */
  stream: Readable;
  /** MIME type of the video (e.g. "video/mp4"). */
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /** Category key (simex | calendars | general). */
  category: string;
  /** Video title (max 100 chars). */
  title: string;
  /** Video description (max 5000 bytes). */
  description: string;
  /** Privacy status override. */
  privacy?: string;
}

export interface UploadResult {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  privacy: string;
  category: string;
}

/**
 * Uploads a video to YouTube via resumable upload, then adds it to the
 * appropriate category playlist.
 *
 * The video body is streamed directly from the request — no temp file
 * is ever written to disk. Only metadata is returned and stored.
 */
export async function uploadVideo(params: UploadParams): Promise<UploadResult> {
  const { stream, mimeType, category, title, description } = params;
  const privacy =
    params.privacy ??
    (['public', 'unlisted', 'private'].includes(process.env.YOUTUBE_PRIVACY ?? '')
      ? process.env.YOUTUBE_PRIVACY!
      : 'unlisted');

  if (!Object.hasOwn(CATEGORIES, category)) {
    throw new YouTubeApiError(`Unknown video category: "${category}"`, 400, 'badRequest');
  }

  const playlistId = await ensurePlaylistId(category, privacy);

  // ── Upload ────────────────────────────────────────────────────────────
  let videoData: youtube_v3.Schema$Video;
  try {
    const yt = getYouTubeClient();
    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          categoryId: EDUCATION_CATEGORY_ID,
        },
        status: {
          privacyStatus: privacy,
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        mimeType,
        body: stream,
      },
    });
    videoData = res.data;
  } catch (err) {
    throw normalizeApiError(err);
  }

  if (!videoData.id) {
    throw new YouTubeApiError('YouTube did not return a video ID after upload.', 502);
  }

  // ── Add to playlist ───────────────────────────────────────────────────
  try {
    const yt = getYouTubeClient();
    await yt.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId: videoData.id,
          },
        },
      },
    });
  } catch (err) {
    const apiErr = normalizeApiError(err);
    throw new YouTubeApiError(
      `Video uploaded (id ${videoData.id}) but couldn't be added to the ` +
        `"${CATEGORIES[category]}" playlist: ${apiErr.message}`,
      apiErr.status,
      apiErr.reason
    );
  }

  const thumbnails = videoData.snippet?.thumbnails ?? {};
  return {
    id: videoData.id,
    title: videoData.snippet?.title ?? title,
    description: videoData.snippet?.description ?? description,
    thumbnail:
      thumbnails.high?.url ??
      thumbnails.medium?.url ??
      thumbnails.default?.url ??
      '',
    privacy: videoData.status?.privacyStatus ?? privacy,
    category,
  };
}
