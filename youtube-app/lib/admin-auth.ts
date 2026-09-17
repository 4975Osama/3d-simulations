/**
 * Admin authentication — server-side only.
 *
 * Mirrors the existing Express approach: password → HMAC-SHA256 signed cookie.
 * The cookie value is `{expires}.{signature}` — timing-safe comparison
 * prevents side-channel attacks.
 *
 * The ADMIN_PASSWORD env var must be set to enable uploads.
 * AUTH_SECRET signs the cookie; if blank, a random one is used per start.
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'yt_admin';
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours

function getAuthSecret(): string {
  // Falls back to a per-process random secret if not set.
  // Sessions won't survive a restart, but that's acceptable.
  if (!process.env.__RUNTIME_AUTH_SECRET) {
    process.env.__RUNTIME_AUTH_SECRET =
      process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
  }
  return process.env.__RUNTIME_AUTH_SECRET;
}

function hmac(value: string): string {
  return crypto
    .createHmac('sha256', getAuthSecret())
    .update(value)
    .digest('base64url');
}

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Is admin login enabled? (i.e. is ADMIN_PASSWORD set?)
 */
export function isLoginEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

/**
 * Reads the admin cookie from a NextRequest and validates it.
 */
export function isAdmin(request: NextRequest): boolean {
  const cookie = request.cookies.get(COOKIE_NAME)?.value ?? '';
  const [expires, mac] = cookie.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;

  const given = Buffer.from(mac);
  const expected = Buffer.from(hmac(expires));
  return (
    given.length === expected.length && crypto.timingSafeEqual(given, expected)
  );
}

/**
 * Validates a password attempt and sets the admin cookie on the response.
 * Returns true on success.
 */
export async function login(
  password: string,
  response: NextResponse
): Promise<boolean> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;

  const ok = crypto.timingSafeEqual(
    digest(String(password)),
    digest(adminPassword)
  );
  if (!ok) {
    // Slow down brute force
    await new Promise((r) => setTimeout(r, 700));
    return false;
  }

  const expires = String(Date.now() + SESSION_MS);
  const cookieValue = `${expires}.${hmac(expires)}`;

  response.cookies.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MS / 1000,
    path: '/',
  });

  return true;
}

/**
 * Clears the admin cookie.
 */
export function logout(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
}

/**
 * Helper for route handlers: returns a 401 JSON response if the request
 * doesn't carry a valid admin cookie.
 */
export function requireAdmin(request: NextRequest): NextResponse | null {
  if (isAdmin(request)) return null;
  return NextResponse.json(
    { error: 'Log in as admin to perform this action.' },
    { status: 401 }
  );
}

/**
 * Signs a value for use as a CSRF state token in the OAuth flow.
 */
export function signState(): string {
  const ts = String(Date.now());
  return `${ts}.${hmac(ts)}`;
}

/**
 * Validates a CSRF state token. Tokens older than 10 minutes are rejected.
 */
export function verifyState(state: string): boolean {
  const [ts, mac] = (state || '').split('.');
  if (!ts || !mac) return false;

  // Reject stale tokens (10-minute window)
  const age = Date.now() - Number(ts);
  if (age < 0 || age > 10 * 60 * 1000) return false;

  const expected = Buffer.from(hmac(ts));
  const given = Buffer.from(mac);
  return (
    given.length === expected.length && crypto.timingSafeEqual(given, expected)
  );
}
