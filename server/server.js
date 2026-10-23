/* Runs the portal locally: npm start, then open the address it prints. */

import app, { ADMIN_PASSWORD, videos } from './app.js';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`3D Simulation Portal → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/portal/`);
  if (!videos.configured) console.warn(`Video storage not set up: add ${videos.missing.join(', ')} to server/.env, then run npm run setup`);
  if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD not set: video uploads are disabled.');
  else if (ADMIN_PASSWORD.length < 12) {
    console.warn('ADMIN_PASSWORD is short: anyone who can reach this server could guess it and change your videos.');
  }
});
