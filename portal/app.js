/**
 * Demo harness: MapLibre GL basemap (fully local vector data, no tile server
 * required) + the animated WebGL water-surface fill from ../waterSurface.js,
 * applied to the rivers, riverbanks and reservoirs of the Indus basin.
 */
import earcut from './vendor/earcut.js';
import water, { PALETTES } from '../waterSurface.js';
import { initTour } from './tour.js';

const $ = (id) => document.getElementById(id);

/* --------------------------------------------------------------- basemap styles */

const STYLES = {
  terrain:   { bg: '#dcd9cd', land: '#cfcab8', pk: '#dbd6c2', border: '#9c937c',
               prov: '#b0a68d', city: '#5c5340', label: 'light', raster: null },
  satellite: { bg: '#0c1410', land: '#16241a', pk: '#1d3022', border: '#3f5c44',
               prov: '#33513a', city: '#c8dbc0', label: 'dark',
               raster: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
               attrib: 'Esri, Maxar, Earthstar Geographics' },
  dark:      { bg: '#080b10', land: '#131822', pk: '#19202c', border: '#2c3644',
               prov: '#232c39', city: '#8fa3bb', label: 'dark', raster: null },
  streets:   { bg: '#eeece5', land: '#e6e2d8', pk: '#f2efe7', border: '#c2bcac',
               prov: '#d2ccbc', city: '#4a4a44', label: 'light',
               raster: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
               attrib: '© OpenStreetMap contributors' },
};

function buildStyle(name, data) {
  const s = STYLES[name];
  const sources = {
    land: { type: 'geojson', data: data.land },
    prov: { type: 'geojson', data: data.provinces },
    places: { type: 'geojson', data: data.places },
    rivers: { type: 'geojson', data: data.rivers },
  };
  const hasRaster = !!s.raster;
  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': s.bg } },
  ];
  if (hasRaster) {
    sources.sat = { type: 'raster', tiles: [s.raster], tileSize: 256, maxzoom: 18,
                    attribution: s.attrib };
    layers.push({ id: 'sat', type: 'raster', source: 'sat',
                  paint: { 'raster-opacity': 1, 'raster-fade-duration': 200 } });
    // vector land stays underneath as an offline fallback if tiles never arrive
    layers.splice(1, 0, { id: 'land', type: 'fill', source: 'land',
      paint: { 'fill-color': ['case', ['==', ['get', 'pk'], 1], s.pk, s.land] } });
  } else {
    layers.push(
      { id: 'land', type: 'fill', source: 'land',
        paint: { 'fill-color': ['case', ['==', ['get', 'pk'], 1], s.pk, s.land] } },
      { id: 'prov', type: 'line', source: 'prov',
        paint: { 'line-color': s.prov, 'line-width': 0.8, 'line-dasharray': [3, 2] } },
      { id: 'border', type: 'line', source: 'land',
        paint: { 'line-color': s.border, 'line-width': 1.2 } },
    );
  }
  layers.push(
    // faint bank outline so the network still reads when zoomed far out
    { id: 'river-hint', type: 'line', source: 'rivers',
      paint: { 'line-color': hasRaster ? '#8fd0ff' : (name === 'terrain' ? '#7ba6c9' : '#3f7fb5'),
               'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 9, 1.1],
               'line-opacity': hasRaster ? 0.35 : 0.55 } },
    { id: 'city', type: 'circle', source: 'places',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 10, 5],
               'circle-color': s.city, 'circle-opacity': 0.9,
               'circle-stroke-width': 1, 'circle-stroke-color': 'rgba(0,0,0,.35)' } },
  );
  return { version: 8, sources, layers };
}

/* ------------------------------------------------------------------------ data */

const [land, provinces, places, rivers, floods] = await Promise.all(
  ['land', 'provinces', 'places', 'pk_rivers', 'pk_floods'].map((f) =>
    fetch(`./public/${f}.geojson`).then((r) => r.json()))
);
const data = { land, provinces, places, rivers, floods };

/* stage the 2022 inundation replay: every flood sheet gets a `reveal` delay
   on the setGrow() clock, ordered north -> south by polygon latitude, so the
   cinematic scene can replay how the water spread from the Punjab belts down
   through Sindh (0 = first, 0.84 = last; the fill itself is inside-out:
   interiors first, shoreline last — handled by the shader). */
{
  let lo = Infinity, hi = -Infinity;
  const lat = (f) => {
    const ring = f.geometry.type === 'MultiPolygon'
      ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0];
    let s = 0, n = 0;
    for (let i = 0; i < ring.length; i += 4) { s += ring[i][1]; n++; }
    return s / Math.max(1, n);
  };
  for (const f of floods.features) {
    const y = lat(f);
    f.properties.reveal = y;
    if (y < lo) lo = y; if (y > hi) hi = y;
  }
  for (const f of floods.features) {
    f.properties.reveal = ((hi - f.properties.reveal) / (hi - lo)) * 0.84;
  }
}

/* ------------------------------------------------------------------------- map */

let styleName = 'satellite';         // portal boots in the 3D satellite view
const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(styleName, data),
  center: [72.86, 34.13],           // portal hero: Tarbela reservoir, 3D satellite
  zoom: 11.0,
  pitch: 28,
  bearing: 10,
  offset: [150, -15],               // lake centres in the visible area (east of the panel)
  maxZoom: 17,
  attributionControl: { compact: true },
  antialias: true,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');
map.dragRotate.enable();
map.touchZoomRotate.enableRotation();

// city labels as DOM markers (keeps the style glyph-free -> zero network deps)
const markers = places.features.slice(0, 26).map((f) => {
  const el = document.createElement('div');
  el.className = 'marker' + (STYLES[styleName].label === 'light' ? ' light' : '');
  el.textContent = f.properties.name;
  return new maplibregl.Marker({ element: el, anchor: 'left' })
    .setLngLat(f.geometry.coordinates).addTo(map);
});

/* ------------------------------------------------ overlay canvas + water layer */

const canvas = document.createElement('canvas');
canvas.id = 'water';
canvas.style.pointerEvents = 'none';
map.getContainer().appendChild(canvas);

const gl = canvas.getContext('webgl', {
  alpha: true, stencil: true, antialias: true, premultipliedAlpha: true, depth: false,
});
if (!gl) throw new Error('WebGL unavailable');

const DPR = Math.min(window.devicePixelRatio || 1, 2);
function resize() {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  water.invalidateProjection();
}
window.addEventListener('resize', resize);
map.on('resize', resize);
resize();

water.init(gl, canvas, { earcut, pixelRatio: DPR });
water.setPalette(styleName);

let bodiesMode = 'rivers';
function setBodies(mode) {
  bodiesMode = mode;
  const row = document.getElementById('bodies');
  if (row) [...row.children].forEach((c) => c.classList.toggle('on', c.dataset.bodies === mode));
  console.time('[demo] setPolygons (triangulate + SDF rasters)');
  const feats =
    mode === 'rivers' ? rivers.features :
    mode === 'floods' ? floods.features :
    rivers.features.concat(floods.features);
  water.setPolygons({ type: 'FeatureCollection', features: feats }, {
    // the caller owns the hydrology: flow bearing (deg) and mean surface speed (m/s)
    // (flood features carry no bearing -> dominant-axis fallback, speed 0.15 -> calm)
    bearingByFeature: (f) => f.properties.bearing,
    avgSpeedByFeature: (f) => f.properties.speed,
  });
  console.timeEnd('[demo] setPolygons (triangulate + SDF rasters)');
  const st = water.stats();
  $('npoly').textContent = st.polygons;
  $('nvert').textContent = st.vertices.toLocaleString();
}
setBodies('rivers');

['move', 'zoom', 'rotate', 'pitch', 'moveend'].forEach((e) =>
  map.on(e, () => water.invalidateProjection()));
map.on('data', (e) => { if (e.sourceId === 'dem') water.invalidateProjection(); });

/* -------------------------------------------------------------- projection fns */

// exact, per-vertex — what the layer should always use
const projectExact = (lon, lat) => map.project([lon, lat]);

// deliberately broken alternative for the diagnostics toggle: a coarse 4×4
// interpolated lon/lat→screen grid. Fine zoomed out, shears the mesh into
// spiky slivers when zoomed in or pitched.
let coarse = false;
let grid = null;
function rebuildGrid() {
  const b = map.getBounds();
  const N = 4, x0 = b.getWest(), y0 = b.getSouth(), x1 = b.getEast(), y1 = b.getNorth();
  const pts = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const p = map.project([x0 + ((x1 - x0) * i) / N, y0 + ((y1 - y0) * j) / N]);
    pts.push(p.x, p.y);
  }
  grid = { N, x0, y0, x1, y1, pts };
}
function projectCoarse(lon, lat) {
  if (!grid) rebuildGrid();
  const { N, x0, y0, x1, y1, pts } = grid;
  const fx = Math.min(Math.max(((lon - x0) / (x1 - x0)) * N, 0), N - 1e-6);
  const fy = Math.min(Math.max(((lat - y0) / (y1 - y0)) * N, 0), N - 1e-6);
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j;
  const at = (ii, jj) => { const k = (jj * (N + 1) + ii) * 2; return [pts[k], pts[k + 1]]; };
  const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const [x, y] = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  return { x, y };
}
map.on('moveend', () => { if (coarse) rebuildGrid(); });

/* --------------------------------------------------------------------- ui wire */

let speed = 1, playing = true, spinning = false;

$('speed').addEventListener('input', (e) => {
  speed = +e.target.value;
  $('spdv').textContent = speed.toFixed(2) + '×';
});
$('play').addEventListener('click', (e) => {
  playing = !playing;
  water.setPaused(!playing);
  e.target.classList.toggle('on', playing);
  e.target.textContent = playing ? '⏸ Pause' : '▶ Play';
});
$('rain').addEventListener('click', (e) => {
  const on = !e.target.classList.contains('on');
  water.setRain(on);
  e.target.classList.toggle('on', on);
});
$('tilt').addEventListener('click', (e) => {
  const on = map.getPitch() < 30;
  map.easeTo({ pitch: on ? 60 : 0, duration: 900 });
  e.target.classList.toggle('on', on);
});
$('terrain3d').addEventListener('click', (e) => {
  const on = !e.target.classList.contains('on');
  if (on) {
    if (!map.getSource('dem')) {
      map.addSource('dem', {
        type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 13,
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      });
    }
    map.setTerrain({ source: 'dem', exaggeration: 1.6 });
    if (map.getPitch() < 30) map.easeTo({ pitch: 62, duration: 900 });
  } else {
    map.setTerrain(null);
  }
  e.target.classList.toggle('on', on);
});
$('spin').addEventListener('click', (e) => {
  spinning = !spinning;
  e.target.classList.toggle('on', spinning);
});
$('coarse').addEventListener('click', (e) => {
  coarse = !coarse;
  if (coarse) rebuildGrid();
  water.invalidateProjection();
  e.target.classList.toggle('on', coarse);
});

$('looks').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-look]');
  if (!b) return;
  [...$('looks').children].forEach((c) => c.classList.toggle('on', c === b));
  water.setLook(b.dataset.look);
});
$('bodies').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-bodies]');
  if (!b || b.classList.contains('on')) return;
  [...$('bodies').children].forEach((c) => c.classList.toggle('on', c === b));
  // setPolygons is synchronous (triangulation + distance fields) -- let the
  // button state paint first, then busy-cursor through the rebuild
  document.body.style.cursor = 'wait';
  setTimeout(() => { setBodies(b.dataset.bodies); document.body.style.cursor = ''; }, 40);
});
$('opacity').addEventListener('input', (e) => {
  const v = +e.target.value;
  $('opv').textContent = v + '%';
  water.setOpacity(v / 100);
});

/* ------------------------------------------------- guided cinematic tour */

const tour = initTour({
  map, water,
  setBodies,
  getBodies: () => bodiesMode,
  clickStyle: (n) => {
    const b = document.querySelector(`#styles button[data-style="${n}"]`);
    if (b && !b.classList.contains('on')) b.click();
  },
  clickLook: (n) => {
    const b = document.querySelector(`#looks button[data-look="${n}"]`);
    if (b && !b.classList.contains('on')) b.click();
  },
  isSpinning: () => spinning,
  setSpinning: (on) => { if (spinning !== !!on) $('spin').click(); },
  isTerrain3d: () => $('terrain3d').classList.contains('on'),
  setTerrain3d: (on) => { if ($('terrain3d').classList.contains('on') !== !!on) $('terrain3d').click(); },
});
$('tour').addEventListener('click', () => (tour.isRunning() ? tour.stop() : tour.start()));
window.tour = tour;

$('styles').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-style]');
  if (!b) return;
  styleName = b.dataset.style;
  [...$('styles').children].forEach((c) => c.classList.toggle('on', c === b));
  const terrainOn = $('terrain3d').classList.contains('on');
  map.setStyle(buildStyle(styleName, data));
  map.once('styledata', () => {
    if (terrainOn && map.getSource('dem')) map.setTerrain({ source: 'dem', exaggeration: 1.6 });
    water.invalidateProjection();
  });
  water.setPalette(styleName);            // swap u_deep/u_shallow/u_foam/u_op/u_glint
  const light = STYLES[styleName].label === 'light';
  markers.forEach((m) => m.getElement().classList.toggle('light', light));
});

const SPOTS = [
  ['Sukkur',   { center: [68.935, 27.828], zoom: 11.9, pitch: 45, bearing: -20 }],   // braided Indus, 15 islands
  ['Ghazi',    { center: [72.540, 34.003], zoom: 12.4, pitch: 50, bearing: -35 }],   // 114-island reach
  ['Tarbela',  { center: [72.824, 34.202], zoom: 10.5, pitch: 52, bearing: -25 }],
  ['Mangla',   { center: [73.685, 33.232], zoom: 10.7, pitch: 50, bearing: 25 }],
  ['Panjnad',  { center: [70.874, 29.227], zoom: 10.6, pitch: 50, bearing: 10 }],
  ['Manchar',  { center: [67.662, 26.427], zoom: 10.9, pitch: 45, bearing: 0 }],
  ['Floodplain', { center: [68.20, 27.75], zoom: 8.7, pitch: 48, bearing: 15 }],
  ['Nowshera', { center: [71.980, 34.020], zoom: 12.0, pitch: 48, bearing: 70 }],
  ['Hunza',    { center: [74.640, 36.320], zoom: 11.8, pitch: 58, bearing: -60 }],
  ['Delta',    { center: [68.356, 25.517], zoom: 9.6,  pitch: 40, bearing: 0 }],
  ['Basin',    { center: [70.550, 29.050], zoom: 5.2,  pitch: 0,  bearing: 0 }],
];
SPOTS.forEach(([label, opts]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => map.flyTo({ ...opts, duration: 2200, essential: true }));
  $('spots').appendChild(b);
});

/* ------------------------------------------------------------------ main loop */

let last = performance.now();
let acc = 0, frames = 0;

function frame(now) {
  const dt = (now - last) / 1000;
  last = now;

  if (spinning) map.setBearing((map.getBearing() + dt * 6) % 360);

  // §7: render(dt, mapBearingDegrees, speedMultiplier, projectFn) + pitch for
  // the grazing-view reflection boost (u_pitch)
  water.render(dt, map.getBearing(), speed, coarse ? projectCoarse : projectExact, map.getPitch());

  acc += dt; frames++;
  if (acc >= 0.5) {
    const s = water.stats();
    $('fps').textContent = (frames / acc).toFixed(0);
    $('drawn').textContent = s.drawn;
    $('pms').textContent = s.lastProjectMs.toFixed(1);
    $('nproj').textContent = s.projections.toLocaleString();
    $('zoom').textContent = map.getZoom().toFixed(1);
    $('pitch').textContent = map.getPitch().toFixed(0);
    acc = 0; frames = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

map.once('load', () => {
  const boot = $('boot');
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 600);
  // portal boots in 3D: satellite + terrain + gentle oblique camera
  if (!map.getSource('dem')) {
    map.addSource('dem', {
      type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 13,
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    });
  }
  if ($('terrain3d').classList.contains('on')) map.setTerrain({ source: 'dem', exaggeration: 1.6 });
});
setTimeout(() => { const b = $('boot'); if (b) { b.style.opacity = '0'; setTimeout(() => b.remove(), 600); } }, 4000);

window.water = water;   // handy for console poking
window.map = map;
