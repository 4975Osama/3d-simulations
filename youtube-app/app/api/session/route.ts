/**
 * GET /api/session
 *
 * Returns the current session state: whether the user is an admin,
 * whether login is enabled, and whether YouTube is configured.
 * This is a public endpoint — every visitor can check session state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, isLoginEnabled } from '@/lib/admin-auth';
import { hasRefreshToken, isOAuthConfigured } from '@/lib/google-auth';

export async function GET(request: NextRequest) {
  return NextResponse.json({
    admin: isAdmin(request),
    loginEnabled: isLoginEnabled(),
    youtubeConfigured: isOAuthConfigured() && hasRefreshToken(),
  });
}
