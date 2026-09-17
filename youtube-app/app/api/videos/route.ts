/**
 * GET /api/videos
 *
 * Lists all videos across category playlists.
 * This is a public endpoint — every visitor can see the video listings.
 * Results are cached in-memory for 60 seconds to conserve API quota.
 */

import { NextResponse } from 'next/server';
import { hasRefreshToken, isOAuthConfigured } from '@/lib/google-auth';
import { CATEGORIES, listVideos, VideoItem, YouTubeApiError } from '@/lib/youtube';

// In-memory cache — simple TTL cache
let listCache: { at: number; videos: Record<string, VideoItem[]> } | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export async function GET() {
  const configured = isOAuthConfigured() && hasRefreshToken();

  if (!configured) {
    // Return empty lists when YouTube isn't set up
    const emptyVideos: Record<string, VideoItem[]> = {};
    for (const key of Object.keys(CATEGORIES)) {
      emptyVideos[key] = [];
    }
    return NextResponse.json({ configured: false, videos: emptyVideos });
  }

  try {
    // Serve from cache if fresh
    if (listCache && Date.now() - listCache.at < CACHE_TTL_MS) {
      return NextResponse.json({ configured: true, videos: listCache.videos });
    }

    const videos = await listVideos();
    listCache = { at: Date.now(), videos };

    return NextResponse.json({ configured: true, videos });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return NextResponse.json(
        { error: err.message },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: `Failed to load videos: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

export { POST } from '../youtube/upload/route';

