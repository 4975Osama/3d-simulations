/**
 * Next.js middleware — protects admin-only routes.
 *
 * Checks the admin session cookie on sensitive routes.
 * Public routes (GET /api/videos, GET /api/session, GET /api/youtube/status)
 * pass through without authentication.
 */

import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'yt_admin';

function getAuthSecret(): string {
  return process.env.AUTH_SECRET || '';
}

async function hmac(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function isAdmin(request: NextRequest): Promise<boolean> {
  const secret = getAuthSecret();
  if (!secret) return true;

  const cookie = request.cookies.get(COOKIE_NAME)?.value ?? '';
  const [expires, mac] = cookie.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;

  const expected = await hmac(expires, secret);
  return mac === expected;
}

// Routes that require admin auth
const PROTECTED_PATTERNS = [
  '/api/youtube/upload',
  '/api/youtube/auth',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect specific routes
  const isProtected = PROTECTED_PATTERNS.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // Allow callback (it validates state token instead)
  if (pathname === '/api/youtube/auth/callback') return NextResponse.next();

  const authed = await isAdmin(request);
  if (!authed) {
    return NextResponse.json(
      { error: 'Admin authentication required.' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/youtube/:path*'],
};

