/* The portal's /api on Vercel: the same Express app server/server.js runs
   locally (vercel.json sends every /api/* request here). */
import app from '../server/app.js';

export default app;
