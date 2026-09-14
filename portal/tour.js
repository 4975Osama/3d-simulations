/**
 * tour.js — cinematic guided tour for the water-surface demo.
 *
 * A scene is a declarative bundle: map style, water bodies dataset, look
 * preset (+optional live overrides), caption and camera. Every scene is
 * replayable, so Prev/Next is just replaying the list. User state (style,
 * dataset, look, opacity, camera, interactions, terrain, orbit) is captured
 * on start and restored on End.
 */

const INTERACT = ['scrollZoom', 'dragPan', 'dragRotate', 'doubleClickZoom',
  'keyboard', 'touchZoomRotate', 'touchPitch'];

const SCENES = [
  {
    id: 'intro', style: 'terrain', bodies: 'rivers', look: 'realistic',
    cam: { center: [69.30, 29.60], zoom: 5.15, pitch: 0, bearing: 0 }, fly: 4600,
    title: "Pakistan's surface water, live",
    body: 'Every blue thing you will see is drawn by one WebGL layer over the basemap: 345 river and lake polygons from OpenStreetMap plus 3,343 flood-extent polygons from UNOSAT satellite data — animated, refractive, reflective. Follow along scene by scene.',
  },
  {
    id: 'geometry', style: 'terrain', bodies: 'rivers', look: 'realistic',
    cam: { center: [72.5365, 34.0005], zoom: 13.3, pitch: 0, bearing: -30 }, fly: 4800,
    title: 'Real geometry, not painted lines',
    body: 'The braided Indus below Tarbela is built from true OSM riverbank multipolygons — 114 genuine islands at this one reach. Each island is a real hole clipped pixel-exactly with a stencil mask: outer ring INCR, holes DECR, surface painted only where coverage is exactly 1.',
  },
  {
    id: 'depth', style: 'dark', bodies: 'rivers', look: 'realistic',
    cam: { center: [71.22, 29.42], zoom: 12.0, pitch: 0, bearing: 0 }, fly: 4800,
    title: 'Why deep water reads dark',
    body: 'Every polygon owns a private distance-to-bank texture — an exact Euclidean distance transform at 640 px. The shader reads it per fragment to blend shallow→deep colour, dampen waves in the middle, and pull foam toward the banks. Dark centre = far from any bank.',
  },
  {
    id: 'flow', style: 'terrain', bodies: 'rivers', look: 'realistic',
    cam: { center: [68.900, 27.860], zoom: 12.6, pitch: 0, bearing: -15 }, fly: 4800,
    title: 'Every reach has a current',
    body: 'Per-feature flow direction (from the river centreline tangents) and mean surface speed drive u_flow and u_scroll: directional wave trains roll downstream, fast in mountain torrents (2.5 m/s), lazy in reservoirs (0.12). The sun glint is anchored to a fixed azimuth of 235° minus the map bearing.',
  },
  {
    id: 'edges', style: 'terrain', bodies: 'rivers', look: 'realistic',
    cam: { center: [68.900, 27.860], zoom: 14.2, pitch: 0, bearing: -15 }, fly: 4000,
    title: 'Edges behave like shores',
    body: 'A foam band hugs the true bank line inside the shallow fringe, and noisy caustic light shimmers only where water is thin. Both counter-scroll with the current so they never look glued to the map. Watch the braid edges drift.',
  },
  {
    id: 'refraction', style: 'dark', bodies: 'rivers', look: 'realistic',
    lookOverrides: { refract: 3.0 },
    cam: { center: [72.5365, 34.0005], zoom: 14.4, pitch: 0, bearing: -35 }, fly: 4200, hold: 9500,
    title: 'Refraction: the bed, through bent light',
    body: 'Wave slopes bend the view ray; the depth texture is re-sampled three times — 1.15 / 1.0 / 0.85, red bends most, blue least — so the riverbed wobbles through passing waves and depth transitions pick up a faint chromatic fringe. Boosted 3× for this scene (default is 1×).',
  },
  {
    id: 'reflection', style: 'satellite', bodies: 'rivers', look: 'glassy',
    cam: { center: [73.685, 33.232], zoom: 10.4, pitch: 55, bearing: 25 }, fly: 5200,
    cam2: { bearing: 145, duration: 9000 }, hold2: 9500, hold: 2500,
    title: 'Reflection: tilt, and the horizon turns to mirror',
    body: 'Fresnel = 4% base plus a wave curve plus a grazing boost from map pitch — upward on screen means grazing. The sky is a two-stop gradient (day blue on this style) with a warm glow around the suns mirror position. Watch the glow sweep as the camera slowly orbits…',
  },
  {
    id: 'floods', style: 'satellite', bodies: 'floods', look: 'realistic',
    cam: { center: [72.15, 34.10], zoom: 7.3, pitch: 10, bearing: 0 }, fly: 5600,
    cam2: { center: [68.35, 27.60], zoom: 8.7, pitch: 42, bearing: -18, duration: 22000 },
    hold: 3200, hold2: 7000,
    grow: { duration: 19000 },
    rebuild: true,
    title: 'Flood 2022 — how the water spread',
    body: 'A drone-view replay of the catastrophic monsoon: we ride the wave south — the northern belts flood first while we pass Punjab, and the giant standing sea caps the Sindh floodplain as we arrive. Each of the 3,343 satellite-mapped sheets fills from its interior out to its mapped shoreline — the lowest ground darkens first, the bank line last, with a lit lip riding the front. Extents: UNOSATs cumulative VIIRS mask, 01–31 Aug 2022 (~91,400 km²). Real observations, real geometry — only the clock is compressed.',
  },
  {
    id: 'floodplain', style: 'dark', bodies: 'floods', look: 'realistic',
    cam: { center: [68.20, 27.75], zoom: 8.6, pitch: 53, bearing: 20 }, fly: 5200, hold: 10000,
    title: 'Inside the Sindh floodplain',
    body: 'Pale sheets are shallow standing water (the same distance field), dark chips inside them are dry hamlets clipped out as holes, and silvery edges are the night sky — the dark style drops reflection strength to 0.8 with a dim sky. The same physics, a very different story.',
  },
  {
    id: 'finale', style: 'dark', bodies: 'rivers', look: 'realistic',
    cam: { center: [72.5365, 34.0005], zoom: 12.9, pitch: 55, bearing: 160 }, fly: 5600,
    cam2: { bearing: 300, duration: 10000 }, hold2: 10500, hold: 1500,
    title: 'One layer, the whole stack',
    body: 'Real geometry + distance fields + flow physics + refraction + reflection — all of it stateless, every frame. Try the Water look presets (glassy / spec), the opacity slider, and the Water bodies switch. Ending the tour restores your settings.',
  },
];

export function initTour({ map, water, setBodies, getBodies, clickStyle, clickLook, isSpinning, setSpinning, isTerrain3d, setTerrain3d }) {
  let running = false, idx = -1, timer = 0, saved = null, card = null, growRaf = 0;

  /* the flood-spread clock (setGrow). v === undefined only cancels the rAF. */
  function stopGrow(v) {
    cancelAnimationFrame(growRaf); growRaf = 0;
    if (v != null && typeof water.setGrow === 'function') water.setGrow(v);
  }

  /* ------------------------------------------------------------ caption card */
  function ensureCard() {
    if (card) return;
    card = document.createElement('div');
    card.id = 'tourcard';
    card.innerHTML = `
      <div class="tk"><span id="tk-step"></span><span id="tk-dots"></span></div>
      <div class="tt" id="tk-title"></div>
      <div class="tb" id="tk-body"></div>
      <div class="tbtns">
        <button id="tk-prev">‹ Prev</button>
        <button id="tk-next">Next ›</button>
        <span class="tsp"></span>
        <button id="tk-end">✕ End tour</button>
      </div>`;
    document.body.appendChild(card);
    card.querySelector('#tk-prev').addEventListener('click', () => prev());
    card.querySelector('#tk-next').addEventListener('click', () => next());
    card.querySelector('#tk-end').addEventListener('click', () => stop());
  }

  function fillCard(i) {
    const s = SCENES[i];
    card.querySelector('#tk-step').textContent = `Scene ${i + 1} / ${SCENES.length}`;
    card.querySelector('#tk-title').textContent = s.title;
    card.querySelector('#tk-body').textContent = s.body;
    card.querySelector('#tk-dots').innerHTML = SCENES.map(
      (_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    card.querySelector('#tk-prev').disabled = i === 0;
  }

  function note(text) {
    if (card) card.querySelector('#tk-body').textContent = text;
  }

  /* -------------------------------------------------------------- scene play */
  function play(i) {
    if (!running || i < 0 || i >= SCENES.length) return;
    clearTimeout(timer);
    idx = i;
    const s = SCENES[i];
    fillCard(i);
    stopGrow(1);   // default: every staged polygon fully spread; grow scenes re-zero

    // environment / visuals
    if (s.style) clickStyle(s.style);
    // force the preset (the DOM click alone is skipped when the button is
    // already highlighted, which would leak a previous scene's overrides)
    if (s.look) { clickLook(s.look); water.setLook(s.look); }
    if (s.lookOverrides) water.setLook({ ...s.lookOverrides });
    if (s.opacity != null) water.setOpacity(s.opacity);

    const doFly = () => {
      map.flyTo({ ...s.cam, duration: s.fly || 4200, essential: true, curve: 1.18 });
      let total = (s.fly || 4200) + (s.hold || readMs(s));
      if (s.cam2) {
        setTimeout(() => { if (running && idx === i) map.flyTo({ ...s.cam, ...s.cam2, essential: true }); },
          (s.fly || 4200) + 300);
        total += (s.cam2.duration || 4000) + (s.hold2 || 800);
      }
      // staged inundation: run the setGrow clock so the first sheets already
      // start rising during the arrival fly, then in step with the drone dive
      if (s.grow && typeof water.setGrow === 'function') {
        setTimeout(() => {
          if (running && idx === i) {
            water.setGrow(0);
            const t0 = performance.now(), dur = s.grow.duration || 20000;
            const step = (now) => {
              if (!running || idx !== i) return;
              const t = Math.min(1, (now - t0) / dur);
              water.setGrow(t);
              if (t < 1) growRaf = requestAnimationFrame(step);
            };
            growRaf = requestAnimationFrame(step);
          }
        }, Math.max(600, (s.fly || 4200) - 1200));
      }
      timer = setTimeout(() => next(), total);
    };

    if (s.bodies && s.bodies !== getBodies()) {
      note(`Building the “${s.bodies}” geometry (one-off triangulation + distance fields)…`);
      setTimeout(() => {
        setBodies(s.bodies);
        note(s.body);
        doFly();
      }, 120);
    } else {
      doFly();
    }
  }

  function readMs(s) {
    const words = (s.title + ' ' + s.body).split(/\s+/).length;
    return 2400 + Math.min(7000, words * 170);
  }

  function next() { if (!running) return; play((idx + 1) % SCENES.length); }
  function prev() { if (!running) return; play((idx - 1 + SCENES.length) % SCENES.length); }

  function onKey(e) {
    if (!running) return;
    if (e.key === 'Escape') stop();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  }

  /* ---------------------------------------------------------------- lifecycle */
  function start() {
    if (running) return;
    running = true;
    saved = {
      style: document.querySelector('#styles .on')?.dataset.style || 'terrain',
      bodies: getBodies(),
      look: water.getLook(),
      opacity: water.getOpacity(),
      cam: { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() },
      spinning: isSpinning(), terrain3d: isTerrain3d(),
    };
    if (saved.spinning) setSpinning(false);
    if (saved.terrain3d) setTerrain3d(false);
    water.setPaused(false);
    INTERACT.forEach((h) => { try { map[h].disable(); } catch (_) { /* noop */ } });
    ensureCard();
    fillCard(0);
    window.addEventListener('keydown', onKey);
    document.getElementById('tour').classList.add('on');
    document.getElementById('tour').textContent = '🎬 Cinematic tour — stop';
    play(0);
  }

  function stop() {
    if (!running) return;
    running = false;
    clearTimeout(timer);
    stopGrow(1);
    window.removeEventListener('keydown', onKey);
    INTERACT.forEach((h) => { try { map[h].enable(); } catch (_) { /* noop */ } });
    if (card) { card.remove(); card = null; }
    const b = document.getElementById('tour');
    b.classList.remove('on');
    b.textContent = '🎬 Cinematic tour — start';

    if (saved) {
      clickStyle(saved.style);
      if (saved.look.name === 'custom') {
        water.setLook(saved.look);
      } else {
        clickLook(saved.look.name);
        water.setLook(saved.look.name);   // forced reset: drops tour-time overrides
      }
      water.setOpacity(saved.opacity);
      if (saved.bodies !== getBodies()) setBodies(saved.bodies);
      map.flyTo({ ...saved.cam, duration: 2500, essential: true });
      saved = null;
    }
  }

  return { start, stop, next, prev, play, isRunning: () => running, sceneCount: SCENES.length };
}
