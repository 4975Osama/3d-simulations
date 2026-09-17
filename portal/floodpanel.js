/* Flood Extent 2022 panel — Dataset / Palette / Look / Water Opacity / Rain
   ripples / Indus rivers / Replay Spread / Indus Flow. Everything here
   drives the real water engine (window.water, the hidden #bodies/#looks/
   #opacity/#rain legacy controls app.js is wired to, and the cinematic tour
   in portal/tour.js) — no rendering logic lives in this file. */

const $ = (id) => document.getElementById(id);

function ready() { return window.map instanceof maplibregl.Map && window.water && window.tour && window.floodStats; }
function boot() {
  if (!ready()) { setTimeout(boot, 100); return; }
  init();
}
boot();

function init() {
  const { sheets, areaKm2 } = window.floodStats;
  const { reaches } = window.riverStats;
  $('floodSub').textContent = `${sheets.toLocaleString()} sheets · ${Math.round(areaKm2).toLocaleString()} km² (UNOSAT VIIRS)`;
  $('floodFoot').textContent = `${reaches.toLocaleString()} channel reaches (OpenStreetMap)`;

  /* -------------------------------------------------------- Palette (independent water-colour override) */
  $('ddPalette').addEventListener('change', (e) => window.water.setPalette(e.target.value));

  /* -------------------------------------------------------- Look */
  $('ddLook').addEventListener('change', (e) => {
    const b = document.querySelector(`#looks button[data-look="${e.target.value}"]`);
    if (b) b.click();
  });
  document.getElementById('looks').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-look]');
    if (b) $('ddLook').value = b.dataset.look;
  });

  /* -------------------------------------------------------- Water Opacity */
  let lastOpacity = 100;
  $('wopSlider').addEventListener('input', (e) => {
    const v = +e.target.value;
    $('wopv').textContent = v + '%';
    lastOpacity = v || lastOpacity;
    $('opacity').value = v;
    $('opacity').dispatchEvent(new Event('input'));
  });

  /* -------------------------------------------------------- Rain ripples */
  $('chkRain').addEventListener('change', () => $('rain').click());

  /* -------------------------------------------------------- Indus rivers + Flood Extent toggle -> #bodies */
  function syncBodies() {
    const floodOn = $('floodToggle').checked;
    const riverOn = $('chkRivers').checked;
    let mode = floodOn && riverOn ? 'both' : floodOn ? 'floods' : riverOn ? 'rivers' : null;
    if (mode) {
      const b = document.querySelector(`#bodies button[data-bodies="${mode}"]`);
      if (b && !b.classList.contains('on')) b.click();
      if (+$('wopSlider').value === 0) { $('wopSlider').value = lastOpacity; $('wopSlider').dispatchEvent(new Event('input')); }
    } else {
      // both off: nothing to show. The engine always keeps a body mode
      // selected, so represent "off" as opacity 0 instead of an empty mode.
      lastOpacity = +$('wopSlider').value || lastOpacity;
      $('wopSlider').value = 0;
      $('wopSlider').dispatchEvent(new Event('input'));
    }
  }
  $('floodToggle').addEventListener('change', syncBodies);
  $('chkRivers').addEventListener('change', syncBodies);
  syncBodies();   // both start unchecked -- hide water until the user toggles one on

  /* -------------------------------------------------------- Replay Spread / Indus Flow */
  function playScene(i) {
    if (!window.tour.isRunning()) $('tour').click();
    window.tour.play(i);
  }
  $('btnSpread').addEventListener('click', () => playScene(7));   // 'floods' scene: 2022 spread replay
  $('btnFlow').addEventListener('click', () => playScene(3));     // 'flow' scene: every reach has a current
}
