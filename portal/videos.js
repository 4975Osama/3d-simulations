/* Simex Videos / Hazard Calendars / General Videos pages. Videos live on the
   portal's YouTube channel, one playlist per page, managed by the portal
   server (server/). The browser never holds Google credentials: it only calls
   /api/*, and uploading requires the server's admin login. */

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
};

const store = { simex: [], calendars: [], general: [] };
// reachable: null = not checked yet, false = no portal server behind this page
const state = { reachable: null, configured: false, admin: false, loginEnabled: false, error: '' };

async function getJSON(url, options) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (HTTP ${res.status})`), { status: res.status });
  return data;
}

async function loadAll() {
  // settled separately: a failing video list (e.g. a revoked YouTube token)
  // must not hide the session info that says the server *is* configured
  const [session, list] = await Promise.allSettled([getJSON('/api/session'), getJSON('/api/videos')]);
  if (session.status === 'rejected') {
    // no status (network/file://) or 404 (plain static server) = no portal server
    const { status, message } = session.reason;
    state.reachable = Boolean(status) && status !== 404;
    state.error = state.reachable ? message : '';
  } else {
    Object.assign(state, {
      reachable: true, configured: session.value.youtubeConfigured,
      admin: session.value.admin, loginEnabled: session.value.loginEnabled,
    });
    if (list.status === 'fulfilled') {
      Object.assign(store, list.value.videos);
      state.error = '';
    } else {
      state.error = list.reason.message;
    }
  }
}
loadAll();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const embedUrl = (id) => `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;

function cardHTML(v) {
  const thumb = v.thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg`;
  const fallbackSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="%2313131f"/><path d="M140 70l50 20-50 20z" fill="%23ef4444"/><text x="50%" y="80%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-family="sans-serif" font-size="12">YouTube Video</text></svg>`;
  const isPrivate = v.privacy === 'private';
  const privateBadge = isPrivate
    ? '<span class="vpriv" title="Private videos can\'t play in embed player — set to Unlisted in YouTube Studio">Private</span>'
    : '';
  const studioLink = isPrivate
    ? `<a href="https://studio.youtube.com/video/${encodeURIComponent(v.id)}/edit" target="_blank" style="display:inline-block;margin-top:4px;font-size:0.75rem;color:#fbbf24;text-decoration:underline;">Set to Unlisted in YouTube Studio ↗</a>`
    : `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" style="display:inline-block;margin-top:4px;font-size:0.75rem;color:#60a5fa;text-decoration:underline;">Watch on YouTube ↗</a>`;

  return `<div class="vcard">
    <div class="vthumb" data-play="${escapeHtml(v.id)}">
      <img class="vthumbimg" src="${escapeHtml(thumb)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${fallbackSvg}';" />
      ${privateBadge}
      <div class="vplay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
    </div>
    <div class="vinfo">
      <b>${escapeHtml(v.title)}</b><span>${escapeHtml(v.description)}</span>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
        <button class="venlarge" data-enlarge="${escapeHtml(v.id)}" data-title="${escapeHtml(v.title)}">
          <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>Enlarge
        </button>
        ${studioLink}
      </div>
    </div>
  </div>`;
}


function emptyHTML(key) {
  let message;
  if (state.reachable === null) message = 'Loading videos…';
  else if (!state.reachable) {
    message = 'Videos come from the portal server, which isn\'t running for this page.<br>'
      + '<span class="vempty-hint">Start it with <code>cd server &amp;&amp; npm start</code>, then open the portal from the address it prints.</span>';
  } else if (state.error || !state.configured) {
    message = 'YouTube is not connected or token expired.<br>'
      + '<span class="vempty-hint" style="display:block;margin-top:8px;">'
      + '<a href="/api/youtube/auth" target="_blank" style="display:inline-block;padding:8px 16px;background:linear-gradient(135deg, #ef4444, #dc2626);color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem;">🔑 Click here to Connect YouTube / Google Account</a>'
      + '</span>';
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
      thumb.innerHTML = `<iframe src="${embedUrl(thumb.dataset.play)}" title="YouTube video"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"></iframe>`;
    }, { once: true });
  });
  body.querySelectorAll('[data-enlarge]').forEach((b) => {
    b.addEventListener('click', () => openEnlarge(b.dataset.enlarge, b.dataset.title));
  });
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

function openEnlarge(id, title) {
  openModal(`<div class="vmodal-head"><h3>${escapeHtml(title)}</h3><button type="button" class="vmodal-x" data-cancel>✕</button></div>
    <div class="venframe"><iframe src="${embedUrl(id)}" title="${escapeHtml(title)}"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"></iframe></div>`, { wide: true });
}


function promptLogin() {
  return new Promise((resolve) => {
    let loggedIn = false;
    const { el, close } = openModal(`<h3>Admin login</h3>
      <p class="vmodal-note">Uploads are posted to the portal's YouTube channel.</p>
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
  await loadAll();   // fresh check
  if (!state.reachable) {
    alert('The portal server isn\'t running for this page.\n\nStart it with: cd server && npm start');
    return;
  }
  if (!state.configured || state.error) {
    if (confirm('YouTube account connection or refresh token is required.\n\nWould you like to log in to Google now to connect your YouTube channel?')) {
      window.open('/api/youtube/auth', '_blank');
    }
    return;
  }
  if (!state.loginEnabled) {
    alert('Uploads are disabled.\n\nSet ADMIN_PASSWORD in server/.env, then restart the server.');
    return;
  }
  if (!state.admin && !(await promptLogin())) return;
  openUpload(key);
}


function openUpload(key) {
  let xhr = null;
  const { el, close } = openModal(`<h3>Add video</h3>
    <p class="vmodal-note">Uploads to YouTube and adds it to the “${PANELS[key].title}” playlist.</p>
    <form>
      <input name="title" placeholder="Video title" maxlength="100" required />
      <textarea name="description" placeholder="Description (optional)" rows="3" maxlength="5000"></textarea>
      <input name="video" type="file" accept="video/*" required />
      <div class="vprogress" hidden><div class="vprogress-bar"></div><span class="vprogress-txt"></span></div>
      <div class="vmodal-err" hidden></div>
      <div class="vmodal-actions">
        <button type="button" class="vmodal-cancel" data-cancel>Cancel</button>
        <button type="submit" class="primary">Upload to YouTube</button>
      </div>
    </form>`, { onClose: () => xhr?.abort() });

  const form = el.querySelector('form');
  const err = el.querySelector('.vmodal-err');
  const submit = form.querySelector('[type=submit]');
  const progress = el.querySelector('.vprogress');
  const bar = el.querySelector('.vprogress-bar');
  const txt = el.querySelector('.vprogress-txt');

  const fail = (message) => {
    xhr = null;
    progress.hidden = true;
    err.textContent = message;
    err.hidden = false;
    submit.disabled = false;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const file = form.elements.video.files[0];
    if (!file) return;

    const data = new FormData();
    data.append('category', key);
    data.append('title', form.elements.title.value.trim());
    data.append('description', form.elements.description.value.trim());
    data.append('video', file);

    submit.disabled = true;
    err.hidden = true;
    progress.hidden = false;
    bar.style.width = '0%';
    txt.textContent = 'Uploading… 0%';

    xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos');
    xhr.upload.addEventListener('progress', (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      bar.style.width = `${pct}%`;
      txt.textContent = `Uploading… ${pct}%`;
    });
    // browser → server is done; the server is now streaming it to YouTube
    xhr.upload.addEventListener('load', () => { txt.textContent = 'Sending to YouTube…'; });
    xhr.addEventListener('load', () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status === 201 && body.video) {
        xhr = null;
        store[key].push(body.video);
        close();
        if (isShowing(key)) draw(key);
        return;
      }
      if (xhr.status === 401) state.admin = false;
      fail(body.error || `Upload failed (HTTP ${xhr.status}).`);
    });
    xhr.addEventListener('error', () => fail('Upload failed — lost connection to the portal server.'));
    xhr.send(data);
  });
  form.elements.title.focus();
}
