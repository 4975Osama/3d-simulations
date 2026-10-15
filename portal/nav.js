/* Sidebar router: switches between the Dashboard view and the shared #page
   container (map/engine keep running underneath — only display toggles,
   nothing is ever destroyed), expands/collapses the Tech-EW Hazards and
   Boundaries submenus, and delegates page content to the render*Page
   functions each feature module registers on window. */

const $ = (id) => document.getElementById(id);

const RENDERERS = {
  simex: () => window.renderVideoPage('simex'),
  calendars: () => window.renderVideoPage('calendars'),
  general: () => window.renderVideoPage('general'),
  simulations2026: () => window.renderVideoPage('simulations2026'),
  simulations2027: () => window.renderVideoPage('simulations2027'),
};

function setActive(key) {
  document.querySelectorAll('#mainnav .on').forEach((el) => el.classList.remove('on'));
  const el = document.querySelector(`#mainnav [data-page="${key}"]`) || document.querySelector(`#mainnav [data-toggle="${key}"]`);
  if (el) el.classList.add('on');
}

function tryRender(fn, attempt) {
  attempt = attempt || 0;
  try { fn(); } catch (err) {
    if (attempt < 50) setTimeout(() => tryRender(fn, attempt + 1), 150);
    else console.error('[nav] page render failed:', err);
  }
}

function goTo(key) {
  const fn = RENDERERS[key];
  if (key !== 'dashboard' && !fn) key = 'dashboard';   // no page registered (e.g. stale saved setting) — fall back rather than show a blank page
  if (key === 'dashboard') {
    $('dashboard-view').hidden = false;
    $('page').hidden = true;
    setActive('dashboard');
    return;
  }
  $('dashboard-view').hidden = true;
  $('page').hidden = false;
  const ph = document.querySelector('.page-header');
  if (ph) ph.hidden = false;   // some pages (video panels) hide this and draw their own header
  setActive(key);
  tryRender(fn);
}
window.portalGoTo = goTo;

document.querySelectorAll('#mainnav a[data-page]').forEach((el) => {
  el.addEventListener('click', (e) => { e.preventDefault(); goTo(el.dataset.page); });
});
document.querySelectorAll('#mainnav [data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.navgroup').classList.toggle('open');
    // Tech-EW Hazards has no dedicated page any more — it's submenu-only, so
    // it just expands/collapses in place without changing the main view.
    if (RENDERERS[btn.dataset.toggle]) goTo(btn.dataset.toggle);
  });
});

/* ------------------------------------------------------- default landing view */
goTo('dashboard');
