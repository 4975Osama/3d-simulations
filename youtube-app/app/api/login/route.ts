/**
 * POST /api/login
 *
 * Validates the admin password and sets a signed session cookie.
 * Brute-force is throttled by a 700 ms delay on wrong passwords.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isLoginEnabled, login } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  if (!isLoginEnabled()) {
    return NextResponse.json(
      { error: 'Admin login is disabled — set ADMIN_PASSWORD in .env.local.' },
      { status: 503 }
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400 }
    );
  }

  const password = String(body.password ?? '');
  const response = NextResponse.json({ admin: true });
  const ok = await login(password, response);

  if (!ok) {
    return NextResponse.json(
      { error: 'Wrong password.' },
      { status: 401 }
    );
  }

  return response;
}
