/**
 * Google OAuth 2.0 client — server-side only.
 *
 * Creates and configures an OAuth2 client for the YouTube Data API v3.
 * The refresh token is stored as a server env variable and NEVER sent
 * to the browser. All Google/YouTube API calls go through this module.
 *
 * Scopes requested:
 *   - youtube.upload   — upload videos
 *   - youtube          — manage playlists, channel settings
 *   - youtube.readonly — read channel info, video listings
 */

import { OAuth2Client } from 'google-auth-library';

// ── Scopes ──────────────────────────────────────────────────────────────────
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
];

// ── Error ───────────────────────────────────────────────────────────────────
/**
 * Thrown when required OAuth environment variables are missing or invalid.
 */
export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthConfigError';
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new OAuthConfigError(
      `Missing required environment variable: ${name}. ` +
        'See .env.example for setup instructions.'
    );
  }
  return value;
}

/**
 * Creates a bare OAuth2 client from env vars (no credentials set).
 * Used for building the consent URL and exchanging auth codes.
 */
export function createOAuthClient(): OAuth2Client {
  return new OAuth2Client(
    requiredEnv('GOOGLE_CLIENT_ID'),
    requiredEnv('GOOGLE_CLIENT_SECRET'),
    requiredEnv('GOOGLE_REDIRECT_URI')
  );
}

/**
 * Builds the Google OAuth consent URL.
 *
 * @param state  A signed CSRF token that will be validated in the callback.
 * @returns      The full URL to redirect the admin to.
 */
export function buildConsentUrl(state: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',       // get a refresh_token
    prompt: 'consent',            // always show consent (ensures refresh_token)
    include_granted_scopes: true, // incremental auth
    scope: YOUTUBE_SCOPES,
    state,
  });
}

/**
 * Exchanges an authorization code for tokens.
 *
 * @param code  The `code` query parameter from the OAuth callback.
 * @returns     The token response, including `refresh_token` (first time only).
 *
 * ⚠️  The refresh_token is returned ONCE by Google (on the very first consent).
 *     The callback route must display it to the admin so they can save it as
 *     YOUTUBE_REFRESH_TOKEN in the server environment.
 */
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_FILE_PATH = path.join(process.cwd(), '.yt-tokens.json');

export function getRefreshToken(): string {
  if (process.env.YOUTUBE_REFRESH_TOKEN) {
    return process.env.YOUTUBE_REFRESH_TOKEN;
  }
  try {
    if (fs.existsSync(TOKEN_FILE_PATH)) {
      const content = fs.readFileSync(TOKEN_FILE_PATH, 'utf-8');
      const data = JSON.parse(content);
      if (data.refresh_token) {
        process.env.YOUTUBE_REFRESH_TOKEN = data.refresh_token;
        return data.refresh_token;
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}

export function saveRefreshToken(token: string) {
  process.env.YOUTUBE_REFRESH_TOKEN = token;
  try {
    fs.writeFileSync(
      TOKEN_FILE_PATH,
      JSON.stringify({ refresh_token: token, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch (err) {
    console.error('Failed to write refresh token to disk:', err);
  }
}

export async function exchangeCode(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (tokens.refresh_token) {
    saveRefreshToken(tokens.refresh_token);
  }
  return tokens;
}

/**
 * Returns an OAuth2 client pre-loaded with the refresh token.
 * Automatically refreshes access tokens before they expire.
 */
export function authorizedClient(): OAuth2Client {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new OAuthConfigError('No YOUTUBE_REFRESH_TOKEN available.');
  }
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Quick check: are the minimum OAuth env vars set?
 * Does NOT validate the tokens — just checks the config exists.
 */
export function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Quick check: is a refresh token configured?
 */
export function hasRefreshToken(): boolean {
  return Boolean(getRefreshToken());
}

