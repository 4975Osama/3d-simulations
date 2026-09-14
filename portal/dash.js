/* dashboard glue: mirror live engine stats into the side panels, wire the
   quick actions to the simulation controls, drive the clock + 3D hotspots.
   (module runs after app.js — water/map/tour are already window-exposed) */

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------- clock (PST) */
function tickClock() {
  const now = new Date();
  $('clock').textContent = new Intl.DateTimeFormat('en-PK', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' }).format(now);
  $('date').textContent = new Intl.DateTimeFormat('en-PK', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }).format(now);
}
tickClock(); setInterval(tickClock, 15000);

/* ------------------------------------------------------- live stats mirror */
function poll() {
  const t = (id) => ($(id) ? $(id).textContent : '–');
  $('st-fps').textContent = t('fps') + ' fps';
  $('st-polys').textContent = t('drawn');
  $('st-reproj').textContent = 'reprojection ' + t('pms') + ' ms · ' + t('nproj') + ' pts';
  $('r-fps').textContent = t('fps') + ' fps';
  $('r-drawn').textContent = t('drawn') + ' / ' + t('npoly');
  $('r-verts').textContent = t('nvert');
  $('r-reproj').textContent = t('pms') + ' ms (' + t('nproj') + ' pts)';
  $('r-cam').textContent = 'z ' + t('zoom') + ' · ' + t('pitch') + '°';
  try {
    $('r-look').textContent = window.water.getLook().name + ' · ' + window.water.getPalette()
      + ' · ' + (document.querySelector('#bodies .on')?.dataset.bodies || '');
  } catch (_) { /* civet */ }
}
setInterval(poll, 600); poll();

/* ------------------------------------------------------- quick actions */
const HERO = { center: [72.86, 34.13], zoom: 11.0, pitch: 28, bearing: 10, offset: [150, -15] };
$('qa-tour').addEventListener('click', () => $('tour').click());
$('qa-spread').addEventListener('click', () => {
  if (!window.tour.isRunning()) $('tour').click();   // starts the tour engine
  window.tour.play(7);                               // straight to the spread replay
});
$('qa-terrain').addEventListener('click', () => $('terrain3d').click());
$('qa-orbit').addEventListener('click', () => $('spin').click());
$('qa-pause').addEventListener('click', () => $('play').click());
$('qa-reset').addEventListener('click', () => {
  if (window.tour.isRunning()) window.tour.stop();
  window.map.flyTo({ ...HERO, duration: 2600, essential: true });
});

/* ------------------------------------------------------- hotspots = fly-to spots */
{
  const hot = $('hotspots');
  [...$('spots').children].forEach((b) => {
    const chip = document.createElement('button');
    chip.innerHTML = '<span class="dotx"></span>' + b.textContent;
    chip.addEventListener('click', () => b.click());
    hot.appendChild(chip);
  });
}

/* ------------------------------------------------------- hotspot search */
$('q').addEventListener('input', (e) => {
  const s = e.target.value.trim().toLowerCase();
  [...$('spots').children].forEach((b) => {
    b.style.display = !s || b.textContent.toLowerCase().includes(s) ? '' : 'none';
  });
});
$('q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const hit = [...$('spots').children].find((b) => b.style.display !== 'none');
  if (hit) hit.click();
});
