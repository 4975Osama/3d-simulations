/* Password gate for the live portal (Vercel Routing Middleware).

   Runs on Vercel before anything is served: pages, scripts, data, videos and
   the /api function. Visitors without a valid pass get a password page;
   entering SITE_PASSWORD (a Vercel env var) sets a signed cookie good for
   30 days. /__portal_logout clears it. If SITE_PASSWORD is not set the site
   stays locked rather than open.

   The cookie is "<expiry>.<HMAC-SHA256(expiry)>", keyed by the password and
   AUTH_SECRET, so changing the password signs everyone out. Locally
   (npm start) this file does not run; the portal stays open there. */

export const config = { matcher: '/:path*' };

const COOKIE = 'portal_pass';
const LOGIN = '/__portal_login';
const LOGOUT = '/__portal_logout';
const DAYS = 30;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sign(text, password) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${password}\n${process.env.AUTH_SECRET || ''}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
// compares digests, so the time taken doesn't reveal how much of a guess was right
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return hex(x) === hex(y);
}
function readCookie(request, name) {
  const pair = (request.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
}
async function hasPass(request, password) {
  const [expires, mac] = readCookie(request, COOKIE).split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  return same(mac, await sign(expires, password));
}
// carry on to the site as normal
const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });
const safePath = (p) => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : '/');

export default async function middleware(request) {
  const url = new URL(request.url);
  const password = process.env.SITE_PASSWORD || '';

  if (url.pathname === LOGOUT) {
    return new Response(null, { status: 303, headers: {
      location: '/', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    } });
  }
  if (url.pathname === LOGIN && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const next = safePath(form && form.get('next'));
    if (!password || !form || !(await same(String(form.get('password') || ''), password))) {
      return page({ next, error: password ? 'Wrong password. Please try again.' : '', status: 401, locked: !password });
    }
    const expires = String(Date.now() + DAYS * 86400000);
    return new Response(null, { status: 303, headers: {
      location: next, 'cache-control': 'no-store',
      'set-cookie': `${COOKIE}=${expires}.${await sign(expires, password)}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
    } });
  }
  if (password && (await hasPass(request, password))) return pass();

  // no pass: API calls and files get a plain 401; page visits get the password page
  const wantsPage = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
  if (!wantsPage) return new Response('Password required', { status: 401, headers: { 'cache-control': 'no-store' } });
  return page({ next: url.pathname + url.search, status: 401, locked: !password });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function page({ next = '/', error = '', status = 200, locked = false }) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>3D Simulation Portal</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    color:#f8fafc;background:radial-gradient(ellipse at top,#5b0b12 0%,#2a0508 55%,#12090c 100%)}
  .card{width:100%;max-width:380px;padding:32px 28px;border-radius:18px;background:rgba(20,8,12,.78);
    border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(8px)}
  h1{margin:0 0 6px;font:700 22px/1.2 Georgia,"Times New Roman",serif;letter-spacing:.04em;text-transform:uppercase;text-align:center}
  p{margin:0 0 22px;color:#cbd5e1;font-size:14px;text-align:center}
  label{display:block;font-size:13px;color:#cbd5e1;margin-bottom:6px}
  input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.35);
    color:#fff;font-size:15px;outline:none}
  input:focus{border-color:#818cf8;box-shadow:0 0 0 3px rgba(129,140,248,.3)}
  button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:10px;font-size:15px;font-weight:600;color:#fff;cursor:pointer;
    background:linear-gradient(135deg,#6366f1,#4f46e5)}
  button:hover{filter:brightness(1.1)}
  .err{margin:14px 0 0;color:#fca5a5;font-size:13px;text-align:center}
</style></head>
<body><main class="card">
  <h1>3D Simulation Portal</h1>
  <p>${locked ? 'The portal is locked: no password has been set yet.' : 'Enter the password to continue.'}</p>
  <form method="post" action="${LOGIN}">
    <input type="hidden" name="next" value="${esc(next)}">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus${locked ? ' disabled' : ''}>
    <button type="submit"${locked ? ' disabled' : ''}>Open portal</button>
  </form>
  ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
</main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
