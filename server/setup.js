/* One-time setup for video storage: creates the Neon `videos` table and the
   storage bucket, and sets the bucket's CORS rules so the portal's pages may
   upload and play files.
   Run after filling in server/.env:  npm run setup
   Re-run it whenever the portal gets a new address (PORTAL_ORIGINS). */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVideoStore, storageConfigFromEnv } from './videostore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;

const store = createVideoStore(storageConfigFromEnv(env));
if (!store.configured) {
  console.error(`Missing in server/.env: ${store.missing.join(', ')}`);
  process.exit(1);
}
const port = Number(env.PORT) || 8080;
const origins = (env.PORTAL_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port}`)
  .split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);

try {
  for (const line of await store.setup(origins)) console.log(line);
} catch (err) {
  console.error('Setup failed:', err.message);
  process.exit(1);
}
