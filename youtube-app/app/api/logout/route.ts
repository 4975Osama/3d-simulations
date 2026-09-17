/**
 * POST /api/logout
 *
 * Clears the admin session cookie.
 */

import { NextResponse } from 'next/server';
import { logout } from '@/lib/admin-auth';

export async function POST() {
  const response = NextResponse.json({ admin: false });
  logout(response);
  return response;
}
