/* 3D storm cells over the flood hazard sites: rain that falls from a cloud
   deck to the ground, and lightning between them, drawn in world space by a
   Mapbox custom layer, so tilting or rotating the map shows real perspective
   and height (drops near the camera are long streaks, far ones short; the
   clouds hang overhead).

   setCells([{ id, lngLat, severity }]) puts one storm cell over each site,
   with its own rain column, cloud and lightning (effects.js registers them).

   Heights are in real metres above the terrain (exaggerated like the map's
   3D terrain), converted to Mercator units for the custom layer's matrix,
   and drawn relative to each storm's centre for float precision. */

let map = null;
const LAYER_ID = 'storm3d';
const CELL_DROPS = 6000;              // per hazard cell
const CELL_RADIUS_M = 6000;           // a storm cell's rain column
const CELL_CLOUD_M = 2200;            // cloud base over a hazard site
const CELL_MIN_ZOOM = 8;              // like the DOM flood effects: hidden when zoomed out
const STRIKE_GAP = { 'Very High': [2.5, 5], High: [3.5, 7], Medium: [5, 10], Low: [7, 14] };

const state = { cells: [] };          // { id, lngLat, severity, phase, strike, next, elev }

/* ---------------------------------------------------------------- shaders */
const RAIN_VS = `
precision highp float;
attribute vec4 a_seed;                // x01, y01, phase01, end (0 bottom, 1 top)
uniform mat4 u_matrix;                // map matrix * translate(storm centre)
uniform float u_mpm;                  // mercator units per metre
uniform vec3 u_box;                   // width m, depth m, cloud height m
uniform float u_time, u_fall, u_len;
uniform vec2 u_wind;                  // drift (m) over one full fall
varying float v_alpha;
void main() {
  vec2 xy = (a_seed.xy - 0.5) * u_box.xy;
  float f = fract(a_seed.z + u_time / u_fall);            // 0 at the cloud, 1 at the ground
  float z = u_box.z * (1.0 - f) + a_seed.w * u_len;
  xy += u_wind * (f - a_seed.w * u_len / u_box.z);
  float r = length(xy / (0.5 * u_box.xy));
  v_alpha = smoothstep(0.0, 0.08, f) * smoothstep(1.0, 0.92, f)
          * smoothstep(1.0, 0.65, r)                      // round rain column
          * mix(0.25, 1.0, a_seed.w);                     // streak fades towards its tail
  gl_Position = u_matrix * vec4(xy.x * u_mpm, -xy.y * u_mpm, z * u_mpm, 1.0);
}`;
const RAIN_FS = `
precision mediump float;
uniform float u_opacity;
varying float v_alpha;
void main() { gl_FragColor = vec4(0.72, 0.82, 0.95, 1.0) * v_alpha * u_opacity; }`;

// cloud deck: a few stacked noisy layers at cloud height, lit up by lightning
const CLOUD_VS = `
precision highp float;
attribute vec3 a_pos;                 // x, y in -0.5..0.5 of the box, layer index
uniform mat4 u_matrix;
uniform float u_mpm;
uniform vec3 u_box;
varying vec2 v_world;
varying vec2 v_local;
varying float v_layer;
void main() {
  vec2 xy = a_pos.xy * u_box.xy;
  float z = u_box.z + a_pos.z * u_box.z * 0.08;
  v_world = xy;
  v_local = a_pos.xy * 2.0;
  v_layer = a_pos.z;
  gl_Position = u_matrix * vec4(xy.x * u_mpm, -xy.y * u_mpm, z * u_mpm, 1.0);
}`;
const CLOUD_FS = `
precision highp float;
uniform float u_time, u_flash, u_scale, u_density, u_veil;
varying vec2 v_world;
varying vec2 v_local;
varying float v_layer;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 p = v_world / u_scale + vec2(u_time * 0.012, u_time * 0.005) + v_layer * 3.7;
  float d = smoothstep(0.30 - 0.12 * u_density, 0.66, fbm(p));
  float edge = smoothstep(1.0, 0.45, length(v_local));
  float a = d * edge * (0.85 - v_layer * 0.2) * u_veil;   // thinner from straight above, so the map stays readable
  vec3 col = mix(vec3(0.30, 0.33, 0.39), vec3(0.58, 0.61, 0.67), fbm(p * 1.7) * (1.0 - 0.35 * v_layer));   // slate storm cloud, darker underneath
  col += vec3(0.75, 0.8, 1.0) * u_flash * (0.4 + 0.6 * d);
  gl_FragColor = vec4(col * a, a);
}`;

// lightning: a ribbon along a jagged path, additive, widened for the glow pass
const BOLT_VS = `
precision highp float;
attribute vec4 a_pos;                 // x, y, z (m, storm-local), side (-1/1)
uniform mat4 u_matrix;
uniform float u_mpm, u_width;
uniform vec2 u_right;                 // horizontal unit vector across the view
varying float v_side;
void main() {
  vec2 xy = a_pos.xy + u_right * a_pos.w * u_width;
  v_side = a_pos.w;
  gl_Position = u_matrix * vec4(xy.x * u_mpm, -xy.y * u_mpm, a_pos.z * u_mpm, 1.0);
}`;
const BOLT_FS = `
precision mediump float;
uniform float u_bright;
uniform vec3 u_color;
varying float v_side;
void main() { float c = 1.0 - abs(v_side); gl_FragColor = vec4(u_color, 1.0) * c * c * u_bright; }`;

/* ---------------------------------------------------------------- GL setup */
let gl = null, prog = {}, buf = {};
function compile(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('[storm3d] ' + gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(vs, gl.VERTEX_SHADER)); gl.attachShader(p, compile(fs, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[storm3d] ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u, a: Object.fromEntries(attribs.map((k) => [k, gl.getAttribLocation(p, k)])) };
}
function onAdd(m, context) {
  gl = context;
  prog.rain = program(RAIN_VS, RAIN_FS, ['a_seed']);
  prog.cloud = program(CLOUD_VS, CLOUD_FS, ['a_pos']);
  prog.bolt = program(BOLT_VS, BOLT_FS, ['a_pos']);
  // drops: 2 vertices each, same random seed, end flag 0/1
  const seeds = new Float32Array(CELL_DROPS * 8);
  for (let i = 0; i < CELL_DROPS; i++) {
    const x = Math.random(), y = Math.random(), ph = Math.random();
    seeds.set([x, y, ph, 0, x, y, ph, 1], i * 8);
  }
  buf.rain = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.rain); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  // 3 cloud layers, one quad (2 triangles) each
  const q = [];
  for (let l = 0; l < 3; l++) for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) q.push(x, y, l);
  buf.cloud = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.cloud); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q), gl.STATIC_DRAW);
  buf.bolt = gl.createBuffer();
}
function onRemove() { gl = null; prog = {}; buf = {}; }

/* ---------------------------------------------------------------- lightning */
function boltPath(r, h) {
  // midpoint displacement from a point in the cloud to the ground, plus a branch
  const a = Math.random() * Math.PI * 2, d = Math.random() * r;
  const top = [Math.cos(a) * d, Math.sin(a) * d, h];
  const bottom = [top[0] + (Math.random() - 0.5) * h * 0.35, top[1] + (Math.random() - 0.5) * h * 0.35, 0];
  let pts = [top, bottom];
  for (let level = 0, amp = h * 0.18; level < 6; level++, amp *= 0.55) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      next.push([(p[0] + q[0]) / 2 + (Math.random() - 0.5) * amp, (p[1] + q[1]) / 2 + (Math.random() - 0.5) * amp, (p[2] + q[2]) / 2], q);
    }
    pts = next;
  }
  const paths = [pts];
  const from = pts[Math.floor(pts.length * (0.2 + Math.random() * 0.3))];
  const branch = [from];
  for (let i = 1, p = from; i < 14; i++) {
    p = [p[0] + (Math.random() - 0.3) * h * 0.04, p[1] + (Math.random() - 0.5) * h * 0.04, p[2] - h * 0.025];
    if (p[2] <= 0) break;
    branch.push(p);
  }
  paths.push(branch);
  return paths;
}
function boltGeometry(paths) {
  const v = [];
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1], q = path[i];
      v.push(...p, -1, ...p, 1, ...q, 1, ...p, -1, ...q, 1, ...q, -1);
    }
  }
  return new Float32Array(v);
}
// brightness over a strike's ~0.5 s life: a stroke, a dip, a restrike, a fade
const FLICKER = [1, 0.25, 0.95, 0.15, 0.7, 0.35, 0.1, 0];
const flicker = (age) => {
  const t = age / 0.06, i = Math.floor(t);
  if (i >= FLICKER.length - 1) return 0;
  return FLICKER[i] + (FLICKER[i + 1] - FLICKER[i]) * (t - i);
};
function scheduleStrike(s, now, severity, h, r) {
  if (s.strike && now - s.strike.at > 0.6) s.strike = null;
  if (!s.strike && now >= (s.next || 0)) {
    s.strike = { at: now, geom: boltGeometry(boltPath(r, h)) };
    const [lo, hi] = STRIKE_GAP[severity] || STRIKE_GAP.Medium;
    s.next = now + lo + Math.random() * (hi - lo);
  }
  return s.strike ? flicker(now - s.strike.at) : 0;
}

/* ---------------------------------------------------------------- drawing */
function translated(matrix, merc) {
  // matrix * translate(merc) in float64, so storm-local metres keep full precision
  const m = Array.from(matrix), out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    out[r] = m[r]; out[4 + r] = m[4 + r]; out[8 + r] = m[8 + r];
    out[12 + r] = m[r] * merc.x + m[4 + r] * merc.y + m[8 + r] * merc.z + m[12 + r];
  }
  return out;
}
function drawStorm(matrix, s) {
  const { merc, mpm, box, drops, flash, time, cloudScale, density, strike } = s;
  const M = translated(matrix, merc);
  // rain
  let p = prog.rain;
  gl.useProgram(p.p);
  gl.uniformMatrix4fv(p.u.u_matrix, false, M);
  gl.uniform1f(p.u.u_mpm, mpm); gl.uniform3f(p.u.u_box, box[0], box[1], box[2]);
  gl.uniform1f(p.u.u_time, time); gl.uniform1f(p.u.u_fall, 1.6); gl.uniform1f(p.u.u_len, box[2] * 0.035);
  gl.uniform2f(p.u.u_wind, box[2] * 0.06, -box[2] * 0.03);
  gl.uniform1f(p.u.u_opacity, 0.55 + flash * 0.4);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.rain);
  gl.enableVertexAttribArray(p.a.a_seed); gl.vertexAttribPointer(p.a.a_seed, 4, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.LINES, 0, drops * 2);
  gl.disableVertexAttribArray(p.a.a_seed);
  // lightning (two passes: wide glow, thin core)
  if (strike && flash > 0.02) {
    p = prog.bolt;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.u_matrix, false, M); gl.uniform1f(p.u.u_mpm, mpm);
    const b = (map.getBearing() * Math.PI) / 180;
    gl.uniform2f(p.u.u_right, Math.cos(b), -Math.sin(b));
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.bolt);
    gl.bufferData(gl.ARRAY_BUFFER, strike.geom, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(p.a.a_pos); gl.vertexAttribPointer(p.a.a_pos, 4, gl.FLOAT, false, 0, 0);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const [w, bright, col] of [[box[2] * 0.03, 0.35, [0.45, 0.55, 1.0]], [box[2] * 0.006, 1.0, [0.95, 0.97, 1.0]]]) {
      gl.uniform1f(p.u.u_width, w); gl.uniform1f(p.u.u_bright, bright * flash); gl.uniform3f(p.u.u_color, ...col);
      gl.drawArrays(gl.TRIANGLES, 0, strike.geom.length / 4);
    }
    gl.disableVertexAttribArray(p.a.a_pos);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  // clouds last, over the rain that falls out of them
  p = prog.cloud;
  gl.useProgram(p.p);
  gl.uniformMatrix4fv(p.u.u_matrix, false, M);
  gl.uniform1f(p.u.u_mpm, mpm); gl.uniform3f(p.u.u_box, box[0], box[1], box[2]);
  gl.uniform1f(p.u.u_time, time); gl.uniform1f(p.u.u_flash, flash);
  gl.uniform1f(p.u.u_scale, cloudScale); gl.uniform1f(p.u.u_density, density);
  const pitch = map.getPitch();
  gl.uniform1f(p.u.u_veil, 0.18 + 0.82 * Math.min(1, Math.max(0, (pitch - 25) / 35)));
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.cloud);
  gl.enableVertexAttribArray(p.a.a_pos); gl.vertexAttribPointer(p.a.a_pos, 3, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 18);
  gl.disableVertexAttribArray(p.a.a_pos);
}

const ground = (lngLat) => (map.queryTerrainElevation && map.queryTerrainElevation(lngLat, { exaggerated: true })) || 0;

function render(_gl, matrix) {
  if (!gl) return;
  const now = performance.now() / 1000, storms = [];
  let screenFlash = 0;

  if (state.cells.length && map.getZoom() >= CELL_MIN_ZOOM) {
    const { clientWidth: w, clientHeight: h } = map.getCanvas();
    for (const cell of state.cells) {
      const px = map.project(cell.lngLat);
      if (px.x < -w || px.x > 2 * w || px.y < -h || px.y > 2 * h) continue;       // well off screen
      const merc = window.mapboxgl.MercatorCoordinate.fromLngLat(cell.lngLat, cell.elev || (cell.elev = ground(cell.lngLat)));
      const mpm = merc.meterInMercatorCoordinateUnits();
      const sev = cell.severity in STRIKE_GAP ? cell.severity : 'Medium';
      const flash = scheduleStrike(cell, now + cell.phase, sev, CELL_CLOUD_M, CELL_RADIUS_M * 0.6);
      if (px.x > 0 && px.x < w && px.y > 0 && px.y < h) screenFlash = Math.max(screenFlash, flash * 0.6);
      const k = sev === 'Very High' ? 1 : sev === 'High' ? 0.8 : sev === 'Low' ? 0.45 : 0.6;
      storms.push({ merc, mpm, box: [CELL_RADIUS_M * 2, CELL_RADIUS_M * 2, CELL_CLOUD_M],
        drops: Math.round(CELL_DROPS * k), flash, time: now + cell.phase, cloudScale: 2600, density: k, strike: cell.strike });
    }
  }

  setScreenFlash(screenFlash);
  if (!storms.length) return;
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);     // hidden behind hills, never hides them
  for (const s of storms) drawStorm(matrix, s);
  gl.depthMask(true);
  map.triggerRepaint();                                                        // keep the storm moving
}

/* a faint whole-view flash when lightning strikes in sight */
let flashEl = null;
function setScreenFlash(v) {
  if (!flashEl) {
    flashEl = document.createElement('div');
    flashEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;background:radial-gradient(ellipse at 50% 20%,rgba(220,230,255,.55),rgba(200,215,255,.12) 70%);opacity:0';
    map.getCanvasContainer().appendChild(flashEl);
  }
  const o = (v * 0.35).toFixed(3);
  if (flashEl.style.opacity !== o) flashEl.style.opacity = o;
}

/* ---------------------------------------------------------------- layer lifecycle */
// isStyleLoaded() is false while any tile is still loading, so just try, and
// retry shortly if the style itself isn't ready yet
let retry = 0, movedAbove = '';
function ensureLayer() {
  if (!map || !map.getStyle()) return;
  if (map.getLayer(LAYER_ID)) {
    // stay above layers added later (3D buildings etc.); getStyle() leaves custom
    // layers out, so read the draw order, else remember what was on top when we moved
    const order = map.style && map.style._order;
    const layers = map.getStyle().layers, top = layers.length ? layers[layers.length - 1].id : '';
    const onTop = order ? order[order.length - 1] === LAYER_ID : top === movedAbove;
    if (!onTop) { map.moveLayer(LAYER_ID); movedAbove = top; }
    return;
  }
  try { map.addLayer({ id: LAYER_ID, type: 'custom', renderingMode: '3d', onAdd, onRemove, render }); }
  catch (err) { clearTimeout(retry); retry = setTimeout(ensureLayer, 250); }
}

const storm3d = {
  setCells(list) {
    const old = new Map(state.cells.map((c) => [c.id, c]));
    state.cells = list.map((c) => old.get(c.id) || { ...c, phase: Math.random() * 30, next: Math.random() * 6 });
    ensureLayer(); map && map.triggerRepaint();
  },
  addCell(cell) { if (!state.cells.some((c) => c.id === cell.id)) this.setCells([...state.cells, cell]); },
  clearCells() { state.cells = []; map && map.triggerRepaint(); },
  /* fire lightning in every storm cell right away (demos, presentations) */
  strikeNow() { state.cells.forEach((c) => { c.next = 0; c.strike = null; }); map && map.triggerRepaint(); },
};

(function boot() {
  // window.map is the #map <div> until app.js replaces it with the Mapbox map
  if (!window.mapboxgl || !window.map || typeof window.map.getStyle !== 'function') { setTimeout(boot, 150); return; }
  map = window.map;
  window.storm3d = storm3d;
  map.on('style.load', ensureLayer);        // basemap switches drop custom layers
  map.on('styledata', ensureLayer);         // ...and other layers get added above it
  ensureLayer();
})();
