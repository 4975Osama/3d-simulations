/* Video category pages. The files live in the portal's Neon Object Storage
   bucket and their details in its Neon database, both managed by the portal server
   (server/). The browser never holds storage keys: it only calls /api/*, and
   adding or deleting videos requires the server's admin login. Uploads go
   straight from the browser to the bucket through short-lived signed links. */

const $ = (id) => document.getElementById(id);

const PANELS = {
  simex: {
    title: 'Simex Emergency Videos', sub: 'Emergency response simulation exercises',
    icon: '<path d="M4 8l3-4h3l-3 4zm5 0 3-4h3l-3 4zm5 0 3-4h2v4z" opacity=".8"/><path d="M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M10 12l5 2.5-5 2.5z" fill="currentColor" stroke="none"/>',
    grad: 'linear-gradient(135deg, #f43f5e, #dc2626)',
  },
  calendars: {
    title: 'Hazard Calendars', sub: 'Seasonal hazard prediction & preparedness timelines',
    icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4" opacity=".8"/>',
    grad: 'linear-gradient(135deg, #f59e0b, #d946ef)',
  },
  general: {
    title: 'General Safety Videos', sub: 'Disaster preparedness & safety guides',
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"/>',
    grad: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
  },
  simulations2026: {
    title: '2026 Simulations', sub: 'Emergency simulation exercises for 2026',
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h6M7 17h4" opacity=".8"/>',
    grad: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
  },
  simulations2027: {
    title: '2027 Simulations', sub: 'Emergency simulation exercises for 2027',
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h6M7 17h4" opacity=".8"/>',
    grad: 'linear-gradient(135deg, #14b8a6, #0d9488)',
  },
};

const store = Object.fromEntries(Object.keys(PANELS).map((key) => [key, []]));
// reachable: null = not checked yet, false = no portal server behind this page
const state = { reachable: null, configured: false, admin: false, loginEnabled: false, error: '' };

async function getJSON(url, options) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (HTTP ${res.status})`), { status: res.status });
  return data;
}

async function loadAll() {
  // settled separately: a failing video list (e.g. database unreachable)
  // must not hide the session info that says the server *is* configured
  const [session, list] = await Promise.allSettled([getJSON('/api/session'), getJSON('/api/videos')]);
  if (session.status === 'rejected') {
    // no status (network/file://) or 404 (plain static server) = no portal server
    const { status, message } = session.reason;
    state.reachable = Boolean(status) && status !== 404;
    state.error = state.reachable ? message : '';
  } else {
    Object.assign(state, {
      reachable: true, configured: session.value.storageConfigured,
      admin: session.value.admin, loginEnabled: session.value.loginEnabled,
    });
    if (list.status === 'fulfilled') {
      Object.assign(store, list.value.videos);
      state.error = list.value.error || '';
    } else {
      state.error = list.reason.message;
    }
  }
}
loadAll();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const findVideo = (key, id) => store[key].find((v) => v.id === id);
const clock = (s) => {
  if (!(s > 0)) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(sec).padStart(2, '0');
};
const sizeText = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1024 ** 2)) + ' MB');
const playerHTML = (v) => `<video src="${escapeHtml(v.url)}" controls autoplay playsinline preload="metadata"
  ${v.thumbnail ? `poster="${escapeHtml(v.thumbnail)}"` : ''}></video>`;

function cardHTML(v) {
  // no stored thumbnail (browser couldn't decode it at upload): let the player show a frame
  const thumb = v.thumbnail
    ? `<img class="vthumbimg" src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" />`
    : `<video class="vthumbimg" src="${escapeHtml(v.url)}#t=1" preload="metadata" muted playsinline></video>`;
  const date = v.createdAt ? new Date(v.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  return `<div class="vcard">
    <div class="vthumb" data-play="${escapeHtml(v.id)}">
      ${thumb}
      ${v.duration ? `<span class="vdur">${clock(v.duration)}</span>` : ''}
      <div class="vplay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
    </div>
    <div class="vinfo">
      <b>${escapeHtml(v.title)}</b><span>${escapeHtml(v.description)}</span>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;">
        <span class="vmeta">${[date, v.size ? sizeText(v.size) : ''].filter(Boolean).join(' · ')}</span>
        ${state.admin ? `<button class="vdel" data-del="${escapeHtml(v.id)}">Delete</button>` : ''}
      </div>
      <button class="venlarge" data-enlarge="${escapeHtml(v.id)}">
        <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>Enlarge
      </button>
    </div>
  </div>`;
}


function emptyHTML(key) {
  let message;
  if (state.reachable === null) message = 'Loading videos…';
  else if (!state.reachable) {
    message = 'Videos come from the portal server, which isn\'t running for this page.<br>'
      + '<span class="vempty-hint">Start it with <code>cd server &amp;&amp; npm start</code>, then open the portal from the address it prints.</span>';
  } else if (!state.configured) {
    message = 'Video storage isn\'t set up yet.<br>'
      + '<span class="vempty-hint">Add the Neon database and storage keys to <code>server/.env</code>, run <code>npm run setup</code> in <code>server/</code>, then restart the server.</span>';
  } else if (state.error) {
    message = `${escapeHtml(state.error)}<br><span class="vempty-hint">Check <code>DATABASE_URL</code> in <code>server/.env</code> and that the Neon project is running.</span>`;
  } else {
    message = `No videos yet in ${PANELS[key].title}.<br><button class="primary" data-add="${key}">+ Add Video</button>`;
  }
  return `<div class="vempty">${message}</div>`;
}


/* ------------------------------------------------------------------ page */
function isShowing(key) {
  return !$('page').hidden && Boolean($('pageBody').querySelector(`.vheader[data-panel="${key}"]`));
}

function draw(key) {
  const p = PANELS[key];
  const count = store[key].length;
  const header = `<div class="vheader" data-panel="${key}" style="--vgrad:${p.grad}">
    <div class="vhic"><svg viewBox="0 0 24 24">${p.icon}</svg></div>
    <div><h2>${p.title}</h2><div class="vhsub">${p.sub} · ${count} video${count === 1 ? '' : 's'}</div></div>
    <div class="vhsp"></div>
    ${state.admin ? '<button class="vhlogout" id="vhLogout">Log out</button>' : ''}
    <button class="vhadd" data-add="${key}">+ Add Video</button>
    <button class="vhclose" id="vhClose" title="Back to Dashboard">✕</button>
  </div>`;
  const grid = count ? store[key].map(cardHTML).join('') : emptyHTML(key);

  const body = $('pageBody');
  body.innerHTML = `${header}<div class="vgrid">${grid}</div>`;
  body.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => onAddVideo(key)));
  body.querySelector('#vhClose').addEventListener('click', () => window.portalGoTo('dashboard'));
  body.querySelector('#vhLogout')?.addEventListener('click', async () => {
    await getJSON('/api/logout', { method: 'POST' }).catch(() => {});
    state.admin = false;
    draw(key);
  });
  body.querySelectorAll('[data-play]').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const v = findVideo(key, thumb.dataset.play);
      if (v) thumb.innerHTML = playerHTML(v);
    }, { once: true });
  });
  body.querySelectorAll('[data-enlarge]').forEach((b) => {
    b.addEventListener('click', () => {
      body.querySelectorAll('.vthumb video[controls]').forEach((el) => el.pause());
      const v = findVideo(key, b.dataset.enlarge);
      if (v) openEnlarge(v);
    });
  });
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => onDelete(key, b.dataset.del, b)));
}

function renderPage(key) {
  const ph = document.querySelector('.page-header');
  if (ph) ph.hidden = true;   // this page draws its own coloured header instead
  draw(key);
  loadAll().then(() => { if (isShowing(key)) draw(key); });
}
window.renderVideoPage = renderPage;

/* ------------------------------------------------------------------ modals */
function openModal(inner, { wide = false, onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'vmodal';
  el.innerHTML = `<div class="vmodal-box${wide ? ' wide' : ''}">${inner}</div>`;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (!el.isConnected) return;
    el.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-cancel]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
  return { el, close };
}

function openEnlarge(v) {
  openModal(`<div class="vmodal-head"><h3>${escapeHtml(v.title)}</h3><button type="button" class="vmodal-x" data-cancel>✕</button></div>
    <div class="venframe">${playerHTML(v)}</div>`, { wide: true });
}

async function onDelete(key, id, button) {
  const v = findVideo(key, id);
  if (!v || !confirm(`Delete "${v.title}"?\n\nThe file is removed from storage and can't be recovered.`)) return;
  button.disabled = true;
  try {
    await getJSON(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    store[key] = store[key].filter((x) => x.id !== id);
  } catch (ex) {
    if (ex.status === 401) state.admin = false;
    alert(ex.message);
  }
  if (isShowing(key)) draw(key);
}


function promptLogin() {
  return new Promise((resolve) => {
    let loggedIn = false;
    const { el, close } = openModal(`<h3>Admin login</h3>
      <p class="vmodal-note">Only the admin can add or delete videos.</p>
      <form>
        <input type="password" name="password" placeholder="Admin password" autocomplete="current-password" required />
        <div class="vmodal-err" hidden></div>
        <div class="vmodal-actions">
          <button type="button" class="vmodal-cancel" data-cancel>Cancel</button>
          <button type="submit" class="primary">Log in</button>
        </div>
      </form>`, { onClose: () => resolve(loggedIn) });
    const form = el.querySelector('form');
    const err = el.querySelector('.vmodal-err');
    const submit = form.querySelector('[type=submit]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      err.hidden = true;
      try {
        await getJSON('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: form.elements.password.value }),
        });
        state.admin = true;
        loggedIn = true;
        close();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        submit.disabled = false;
        form.elements.password.select();
      }
    });
    form.elements.password.focus();
  });
}

async function onAddVideo(key) {
  if (!(await readyToUpload())) return;
  openUpload({
    category: key, heading: 'Add video', note: `Saved to the portal's video storage and shown on “${PANELS[key].title}”.`,
    onDone: (video) => { store[key].push(video); if (isShowing(key)) draw(key); },
  });
}

/* server running, storage set up, uploads enabled, admin logged in? */
async function readyToUpload() {
  await loadAll();   // fresh check
  if (!state.reachable) {
    alert('The portal server isn\'t running for this page.\n\nStart it with: cd server && npm start');
    return false;
  }
  if (!state.configured) {
    alert('Video storage isn\'t set up yet.\n\nAdd the Neon database and storage keys to server/.env, run "npm run setup" in server/, then restart the server.');
    return false;
  }
  if (!state.loginEnabled) {
    alert('Uploads are disabled.\n\nSet ADMIN_PASSWORD in server/.env, then restart the server.');
    return false;
  }
  return state.admin || promptLogin();
}

/* duration + a JPEG still from ~10% in, read locally before uploading */
const MIME_BY_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg' };
function probeVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let settled = false;
    const done = (out) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      resolve(out);
    };
    const timer = setTimeout(() => done({ duration: null, thumb: null }), 15000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = Number.isFinite(v.duration) ? Math.min(2, v.duration * 0.1) : 0;
    }, { once: true });
    v.addEventListener('seeked', () => {
      const duration = Number.isFinite(v.duration) ? v.duration : null;
      if (!v.videoWidth) return done({ duration, thumb: null });
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = Math.round((640 * v.videoHeight) / v.videoWidth);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((thumb) => done({ duration, thumb }), 'image/jpeg', 0.8);
    }, { once: true });
    v.addEventListener('error', () => done({ duration: null, thumb: null }), { once: true });   // a codec this browser can't decode
    v.src = url;
  });
}

/* target: { category, siteKey?, title?, heading, note, onDone(video) } */
function openUpload(target) {
  let xhr = null;
  const { el, close } = openModal(`<h3>${escapeHtml(target.heading)}</h3>
    <p class="vmodal-note">${escapeHtml(target.note)}</p>
    <form>
      <input name="title" placeholder="Video title" maxlength="100" required value="${escapeHtml(target.title || '')}" />
      <textarea name="description" placeholder="Description (optional)" rows="3" maxlength="5000"></textarea>
      <input name="video" type="file" accept="video/*" required />
      <div class="vprogress" hidden><div class="vprogress-bar"></div><span class="vprogress-txt"></span></div>
      <div class="vmodal-err" hidden></div>
      <div class="vmodal-actions">
        <button type="button" class="vmodal-cancel" data-cancel>Cancel</button>
        <button type="submit" class="primary">Upload</button>
      </div>
    </form>`, { onClose: () => { xhr?.abort(); if (!uploaded) target.onCancel?.(); } });
  let uploaded = false;

  const form = el.querySelector('form');
  const err = el.querySelector('.vmodal-err');
  const submit = form.querySelector('[type=submit]');
  const progress = el.querySelector('.vprogress');
  const bar = el.querySelector('.vprogress-bar');
  const txt = el.querySelector('.vprogress-txt');
  const status = (text, pct) => { txt.textContent = text; if (pct != null) bar.style.width = `${pct}%`; };

  const fail = (message) => {
    xhr = null;
    progress.hidden = true;
    err.textContent = message;
    err.hidden = false;
    submit.disabled = false;
  };

  // PUT straight to the bucket through a signed link, with progress
  const put = (url, file, onProgress) => new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    if (onProgress) xhr.upload.addEventListener('progress', (ev) => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); });
    xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300 ? resolve()
      : reject(new Error(`Storage refused the upload (HTTP ${xhr.status}). If this keeps happening, run "npm run setup" in server/.`))));
    // a CORS block looks like a network error to the page
    xhr.addEventListener('error', () => reject(new Error('Upload failed: couldn\'t reach the video storage. Run "npm run setup" in server/ so the bucket accepts uploads from this address.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
    xhr.send(file);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const picked = form.elements.video.files[0];
    if (!picked) return;
    // some systems give .mkv/.mov files no MIME type: infer it from the extension
    const type = picked.type || MIME_BY_EXT[(picked.name.split('.').pop() || '').toLowerCase()] || '';
    const file = type === picked.type ? picked : new File([picked], picked.name, { type });

    submit.disabled = true;
    err.hidden = true;
    progress.hidden = false;
    status('Reading video…', 0);
    try {
      const { duration, thumb } = await probeVideo(file);
      status('Preparing upload…', 0);
      const start = await getJSON('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: target.category, siteKey: target.siteKey, title: form.elements.title.value.trim(),
          description: form.elements.description.value.trim(),
          mimeType: file.type, size: file.size,
        }),
      });
      await put(start.uploadUrl, file, (f) => status(`Uploading… ${Math.round(f * 100)}%`, Math.round(f * 100)));
      let hasThumb = false;
      if (thumb) {
        status('Saving thumbnail…', 100);
        hasThumb = await put(start.thumbUploadUrl, new File([thumb], 'thumb.jpg', { type: 'image/jpeg' })).then(() => true, () => false);
      }
      status('Saving to the database…', 100);
      const { video } = await getJSON(`/api/videos/${encodeURIComponent(start.id)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration, hasThumb }),
      });
      xhr = null;
      uploaded = true;
      close();
      target.onDone(video);
    } catch (ex) {
      if (ex.status === 401) state.admin = false;
      if (el.isConnected) fail(ex.message);
    }
  });
  form.elements.title.focus();
}

/* ------------------------------------------------- map hazard popups
   effects.js shows one video per hazard site in its popup's video feed. */
let siteVideos = null;
window.portalVideos = {
  /* { "<hazard>:<lng>,<lat>": video }, cached until a site video changes */
  siteVideos() {
    return siteVideos || (siteVideos = getJSON('/api/site-videos').then((r) => r.videos || {}, () => ({})));
  },
  playerHTML,
  /* resolves with the uploaded video, or null if the admin backed out */
  async uploadSiteVideo(siteKey, title, placeName) {
    if (!(await readyToUpload())) return null;
    return new Promise((resolve) => {
      openUpload({
        category: 'site', siteKey, title, heading: 'Video for this site',
        note: `Shown in the video feed of ${placeName}. It replaces this site's current video, if it has one.`,
        onDone: (video) => { siteVideos = null; resolve(video); },
        onCancel: () => resolve(null),
      });
    });
  },
};
