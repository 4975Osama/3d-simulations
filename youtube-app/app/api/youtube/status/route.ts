/**
 * GET /api/youtube/status
 *
 * Checks whether YouTube is connected and validates that the
 * authenticated Google account has a YouTube channel with upload
 * permissions. Returns status message and channel info.
 *
 * This is a public endpoint (no admin auth required) so the
 * dashboard can show connection status to any viewer.
 */

import { NextResponse } from 'next/server';
import { hasRefreshToken, isOAuthConfigured, OAuthConfigError } from '@/lib/google-auth';
import { getChannelInfo, YouTubeApiError } from '@/lib/youtube';

export async function GET() {
  // Step 1: Check OAuth config
  if (!isOAuthConfigured()) {
    return NextResponse.json({
      connected: false,
      status: 'not_configured',
      message: 'Google OAuth credentials are not set. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to .env.local.',
      channel: null,
    });
  }

  // Step 2: Check refresh token
  if (!hasRefreshToken()) {
    return NextResponse.json({
      connected: false,
      status: 'no_token',
      message: 'No refresh token. Click "Connect YouTube" to complete the OAuth flow, then save the refresh token to YOUTUBE_REFRESH_TOKEN in .env.local.',
      channel: null,
    });
  }

  // Step 3: Validate channel access
  try {
    const channel = await getChannelInfo();

    // Optional: verify channel ID matches if YOUTUBE_CHANNEL_ID is set
    const expectedChannel = process.env.YOUTUBE_CHANNEL_ID;
    if (expectedChannel && channel.id !== expectedChannel) {
      return NextResponse.json({
        connected: false,
        status: 'wrong_channel',
        message: `Connected to channel "${channel.title}" (${channel.id}), but YOUTUBE_CHANNEL_ID is set to ${expectedChannel}. Update the env var or use a different Google account.`,
        channel,
      });
    }

    return NextResponse.json({
      connected: true,
      status: 'ready',
      message: `YouTube is connected to "${channel.title}".`,
      channel,
    });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return NextResponse.json({
        connected: false,
        status: 'error',
        message: err.message,
        channel: null,
      }, { status: err.status >= 500 ? 502 : err.status });
    }
    if (err instanceof OAuthConfigError) {
      return NextResponse.json({
        connected: false,
        status: 'config_error',
        message: err.message,
        channel: null,
      }, { status: 503 });
    }
    return NextResponse.json({
      connected: false,
      status: 'error',
      message: `Unexpected error: ${(err as Error).message}`,
      channel: null,
    }, { status: 500 });
  }
}
