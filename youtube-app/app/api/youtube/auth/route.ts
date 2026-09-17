/**
 * GET /api/youtube/auth
 *
 * Redirects the admin to Google's OAuth consent screen.
 * Generates a signed CSRF state token that the callback validates.
 *
 * Protected by middleware — only admins can initiate the OAuth flow.
 */

import { NextResponse } from 'next/server';
import { signState } from '@/lib/admin-auth';
import { buildConsentUrl, OAuthConfigError } from '@/lib/google-auth';

export async function GET() {
  try {
    const state = signState();
    const url = buildConsentUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    if (err instanceof OAuthConfigError) {
      return NextResponse.json(
        { error: err.message },
        { status: 503 }
      );
    }
    throw err;
  }
}
