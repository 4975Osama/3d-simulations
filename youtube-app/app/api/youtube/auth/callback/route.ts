/**
 * GET /api/youtube/auth/callback
 *
 * Google redirects here after the admin grants consent.
 * This endpoint:
 *   1. Validates the CSRF state token
 *   2. Exchanges the authorization code for tokens
 *   3. Returns an HTML page showing the refresh token ONCE
 *
 * ⚠️  The refresh token is shown to the admin exactly once.
 *     They must save it as YOUTUBE_REFRESH_TOKEN in the server's
 *     environment. It is NEVER stored in the app or sent to the browser
 *     again after this page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyState } from '@/lib/admin-auth';
import { exchangeCode, OAuthConfigError } from '@/lib/google-auth';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Google returned an error (e.g. user denied consent)
  if (error) {
    return new NextResponse(callbackPage({
      success: false,
      message: `Google returned an error: ${error}`,
    }), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Validate CSRF state
  if (!state || !verifyState(state)) {
    return new NextResponse(callbackPage({
      success: false,
      message: 'Invalid or expired state token. Please try the OAuth flow again.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!code) {
    return new NextResponse(callbackPage({
      success: false,
      message: 'No authorization code received from Google.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const tokens = await exchangeCode(code);

    if (!tokens.refresh_token) {
      return new NextResponse(callbackPage({
        success: false,
        message:
          'Google did not return a refresh token. This usually means the account ' +
          'has already granted consent. Revoke the app at myaccount.google.com/permissions ' +
          'and try again, or use the existing refresh token.',
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new NextResponse(callbackPage({
      success: true,
      refreshToken: tokens.refresh_token,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Prevent caching of the page that shows the token
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (err) {
    const message =
      err instanceof OAuthConfigError
        ? err.message
        : `Token exchange failed: ${(err as Error).message}`;
    return new NextResponse(callbackPage({
      success: false,
      message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

// ── HTML template ───────────────────────────────────────────────────────────

function callbackPage(
  opts:
    | { success: true; refreshToken: string }
    | { success: false; message: string }
): string {
  const title = opts.success ? 'YouTube Connected!' : 'OAuth Error';
  const body = opts.success
    ? `
      <div class="success-icon">✓</div>
      <h1>YouTube Connected Successfully</h1>
      <p>Your refresh token is shown below. <strong>Copy it now</strong> — it will not be shown again.</p>

      <div class="token-box">
        <label>YOUTUBE_REFRESH_TOKEN</label>
        <textarea id="token" readonly onclick="this.select()">${escapeHtml(opts.refreshToken)}</textarea>
        <button onclick="navigator.clipboard.writeText(document.getElementById('token').value).then(()=>{this.textContent='Copied!'})">
          Copy to clipboard
        </button>
      </div>

      <div class="instructions">
        <h2>Next steps</h2>
        <ol>
          <li>Open your <code>.env.local</code> file</li>
          <li>Set <code>YOUTUBE_REFRESH_TOKEN=</code> to the value above</li>
          <li>Restart the Next.js server</li>
          <li>Go back to the <a href="/">dashboard</a> — it should show "YouTube Ready"</li>
        </ol>
      </div>

      <div class="warning">
        <strong>⚠️ Security</strong>: This token grants full YouTube access to your channel.
        Never commit it to version control. Never expose it to the browser.
        If compromised, revoke it at
        <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a>.
      </div>
    `
    : `
      <div class="error-icon">✕</div>
      <h1>OAuth Error</h1>
      <p class="error-message">${escapeHtml(opts.message)}</p>
      <a href="/" class="back-link">← Back to Dashboard</a>
    `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="robots" content="noindex, nofollow" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0a0a0f;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .container {
      max-width: 600px;
      width: 100%;
      background: linear-gradient(145deg, #13131f, #1a1a2e);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 20px;
      padding: 3rem;
      box-shadow: 0 25px 60px rgba(0,0,0,0.5);
    }
    .success-icon, .error-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 1.5rem;
    }
    .success-icon {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
    }
    .error-icon {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.75rem; color: #f8fafc; }
    p { color: #94a3b8; line-height: 1.6; margin-bottom: 1.5rem; }
    .token-box {
      background: #0f0f1a;
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .token-box label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: #818cf8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .token-box textarea {
      width: 100%;
      background: transparent;
      border: none;
      color: #a5f3fc;
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 0.8rem;
      resize: none;
      height: 60px;
      outline: none;
    }
    .token-box button {
      margin-top: 0.75rem;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      border: none;
      padding: 0.6rem 1.25rem;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      transition: opacity 0.2s;
    }
    .token-box button:hover { opacity: 0.9; }
    .instructions {
      background: rgba(99, 102, 241, 0.08);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .instructions h2 {
      font-size: 0.9rem;
      color: #c7d2fe;
      margin-bottom: 0.75rem;
    }
    .instructions ol {
      padding-left: 1.25rem;
      color: #94a3b8;
      line-height: 1.8;
      font-size: 0.9rem;
    }
    .instructions code {
      background: rgba(99, 102, 241, 0.15);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.85em;
      color: #c7d2fe;
    }
    .instructions a { color: #818cf8; }
    .warning {
      background: rgba(234, 179, 8, 0.08);
      border: 1px solid rgba(234, 179, 8, 0.2);
      border-radius: 12px;
      padding: 1rem 1.25rem;
      font-size: 0.85rem;
      color: #fbbf24;
      line-height: 1.6;
    }
    .warning a { color: #fbbf24; text-decoration: underline; }
    .error-message {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 12px;
      padding: 1rem;
      color: #fca5a5;
      font-size: 0.9rem;
    }
    .back-link {
      display: inline-block;
      color: #818cf8;
      text-decoration: none;
      font-weight: 500;
      margin-top: 0.5rem;
    }
    .back-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">${body}</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
