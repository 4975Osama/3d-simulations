/* 3D tropical cyclone over the coastal hazard sites, drawn in world space by
   a Mapbox custom layer (like storm3d.js / fire3d.js / landslide3d.js):
   spiral cloud bands at real size wheeling anticlockwise (northern
   hemisphere) around a clear eye, heavy rain swept round under the bands,
   lightning lighting up the clouds, the sea whipped into whitecaps and swell,
   surf pounding the coast and the storm surge flooding the low shore.

   Land and sea come from the terrain data: a grid of elevations over the
   storm becomes a sea mask, so foam stays on the water and the surge only
   floods the coastal strip. setCells([{ id, lngLat, severity }]) puts one
   cyclone on each site (effects.js registers them). */

let map = null;
const LAYER_ID = 'coastal3d';
const MIN_ZOOM = 5;
const SEVERITY = {                 // cyclone radius (m), rain share
  'Very High': { R: 110000, k: 1 },
  High: { R: 80000, k: 0.8 },
  Medium: { R: 55000, k: 0.65 },
  Low: { R: 35000, k: 0.5 },
};
// the storm as a 3D volume: real cloud heights, stretched upwards like the map's
// 3D terrain so the towers read when the map is tilted
const CLOUD_VEX = 2.5;             // vertical exaggeration of the clouds
const CLOUD_BASE = 1200 * CLOUD_VEX;   // cloud base (m)
const CLOUD_TOP = 15000 * CLOUD_VEX;   // highest eyewall tops (m)
const CLOUD_SLICES = 28;           // stacked height slices that make up the volume
const RAIN_H = CLOUD_BASE;               // rain falls from the cloud base at this height
const MAX_DROPS = 22000;
const MASK_N = 96;                 // sea-mask grid over the storm (cells per side)
const SURGE_LAND_M = 8;            // land below this (exaggerated m, ~5 m real) next to the sea floods

const state = { cells: [] };

/* ---------------------------------------------------------------- shaders */
const COMMON = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// how far the storm has turned: the pattern rotates as one piece (a radius-dependent
// rate would wind the spiral arms into rings within a minute); the arms' own
// log-spiral shape and a little extra turn near the core keep it cyclonic
float spin(float r, float t) { return mod(t * 0.045, 6.2832) + 0.35 / (r + 0.3); }
// spiral rain/cloud bands: 3 log-spiral arms + a solid eyewall, an empty eye
float bands(vec2 p, float t) {
  float r = length(p);
  vec2 q = rot(p, -spin(r, t));
  float th = atan(q.y, q.x);
  float arm = sin(th * 3.0 + log(r + 0.04) * 6.0);
  float b = smoothstep(-0.35, 0.85, arm);
  float eyewall = smoothstep(0.045, 0.08, r) * smoothstep(0.22, 0.1, r);
  return max(b * smoothstep(1.05, 0.55, r), eyewall) * smoothstep(0.035, 0.065, r);
}`;

const CLOUD_VS = `
precision highp float;
attribute vec3 a_pos;                // x, y in -1..1 of the cyclone radius, layer
uniform mat4 u_matrix;
uniform float u_mpm, u_R;
varying vec2 v_p;
varying float v_layer;
void main() {
  v_p = a_pos.xy * 1.15;
  v_layer = a_pos.z;
  float hf = a_pos.z / ${(CLOUD_SLICES - 1).toFixed(1)};                          // 0 cloud base .. 1 top
  vec3 p = vec3(v_p * u_R, ${CLOUD_BASE.toFixed(1)} + hf * ${(CLOUD_TOP - CLOUD_BASE).toFixed(1)});
  gl_Position = u_matrix * vec4(p.x * u_mpm, -p.y * u_mpm, p.z * u_mpm, 1.0);
}`;
const CLOUD_FS = `
precision highp float;
uniform float u_time, u_density, u_veil, u_tilt;
uniform vec3 u_flash;                // flash centre (unit radius) + brightness
varying vec2 v_p;
varying float v_layer;
${COMMON}
void main() {
  float r = length(v_p);
  float hf = v_layer / ${(CLOUD_SLICES - 1).toFixed(1)};                       // height in the storm, 0..1
  vec2 q = rot(v_p, -spin(r, u_time));
  float n = fbm(q * 7.0 + hf * 2.1);                    // billows, changing with height
  float nT = fbm(q * 3.0 + 11.0);                       // broad variation of the cloud-top height
  float b = bands(v_p, u_time);
  // how high the cloud column reaches here: the eyewall towers tallest, the
  // spiral bands climb to mid-levels, the gaps between them hold low cloud
  float eyewall = smoothstep(0.05, 0.09, r) * (1.0 - smoothstep(0.16, 0.30, r));
  float top = max(eyewall * (0.85 + 0.15 * nT), b * (0.35 + 0.35 * nT)) + 0.08 * n;
  float body = (1.0 - smoothstep(top - 0.10, top + 0.02, hf)) * smoothstep(0.30, 0.55, n + 0.25 * b);
  // the cirrus anvil: a thin sheet spread wide over the top of the storm
  float anvil = smoothstep(0.72, 0.82, hf) * (1.0 - smoothstep(0.88, 0.98, hf)) * smoothstep(0.35, 0.7, fbm(q * 4.0 + 5.0)) * 0.45;
  float edge = (1.0 - smoothstep(0.80, 1.12, r)) * smoothstep(0.045, 0.075, r);   // round storm, clear eye
  // looking across the storm, a sight line crosses fewer slices: each one gets denser
  float a = max(body, anvil) * edge * u_veil * (0.75 + 0.25 * u_density) * 0.20 * u_tilt;
  // dark rain-laden bases, bright sunlit tops
  vec3 col = mix(vec3(0.34, 0.37, 0.42), vec3(0.97, 0.98, 1.0), pow(hf, 0.55)) * (0.85 + 0.15 * n);
  vec2 fd = v_p - u_flash.xy;
  col += vec3(0.7, 0.75, 1.0) * u_flash.z * exp(-dot(fd, fd) * 90.0) * (1.0 - hf * 0.5);   // lightning glows inside
  gl_FragColor = vec4(col * a, a);
}`;

const RAIN_VS = `
precision highp float;
attribute vec4 a_seed;               // angle01, radius01, phase01, end (0 head, 1 tail)
uniform mat4 u_matrix;
uniform float u_mpm, u_R, u_time;
varying float v_alpha;
${COMMON}
void main() {
  float ang = a_seed.x * 6.2832, r = sqrt(a_seed.y) * 1.05;
  vec2 p = vec2(cos(ang), sin(ang)) * r;
  float f = fract(a_seed.z + u_time / 1.4);                 // 0 cloud base, 1 sea
  float len = ${RAIN_H.toFixed(1)} * 0.05;
  vec2 tangent = normalize(vec2(-p.y, p.x) + 1e-5);        // anticlockwise wind
  vec3 head = vec3(p * u_R + tangent * f * 600.0, ${RAIN_H.toFixed(1)} * (1.0 - f));
  vec3 pos = head + vec3(-tangent * a_seed.w * 90.0, a_seed.w * len);
  v_alpha = (0.35 + 0.65 * bands(p, u_time)) * smoothstep(1.05, 0.8, r) * smoothstep(0.0, 0.06, f) * smoothstep(1.0, 0.95, f) * mix(1.0, 0.25, a_seed.w);
  gl_Position = u_matrix * vec4(pos.x * u_mpm, -pos.y * u_mpm, pos.z * u_mpm, 1.0);
}`;
const RAIN_FS = `
precision highp float;
varying float v_alpha;
void main() { gl_FragColor = vec4(0.80, 0.85, 0.92, 1.0) * v_alpha * 0.85; }`;

// the sea surface: whitecaps, swell running out from the storm, surf on the coast, surge on the shore
const SEA_VS = `
precision highp float;
attribute vec2 a_xy;                 // -1..1 of the cyclone radius
uniform mat4 u_matrix;
uniform float u_mpm, u_R;
varying vec2 v_p;
void main() {
  v_p = a_xy * 1.1;
  vec3 p = vec3(v_p * u_R, 3.0);
  gl_Position = u_matrix * vec4(p.x * u_mpm, -p.y * u_mpm, p.z * u_mpm, 1.0);
}`;
const SEA_FS = `
precision highp float;
uniform sampler2D u_mask;            // r: sea (1) / land (0); g: low coastal land the surge can reach
uniform float u_time, u_texel;
varying vec2 v_p;
${COMMON}
void main() {
  vec2 uv = v_p / 2.2 + 0.5;
  vec4 m = texture2D(u_mask, uv);
  float sea = m.r, low = m.g;
  float r = length(v_p);
  float wind = smoothstep(1.1, 0.12, r) * smoothstep(0.03, 0.08, r);   // strongest near the eyewall, calm eye
  // whitecaps streaked along the anticlockwise wind
  vec2 tangent = normalize(vec2(-v_p.y, v_p.x) + 1e-5);
  vec2 along = vec2(dot(v_p, tangent), dot(v_p, vec2(tangent.y, -tangent.x)));
  float caps = smoothstep(0.62, 0.85, fbm(vec2(along.x * 60.0 - u_time * 0.8, along.y * 14.0)));
  // swell rolling out from the storm, broken up by noise so it doesn't form neat rings
  float swell = smoothstep(0.6, 1.0, sin(r * 90.0 - u_time * 1.6 + fbm(v_p * 12.0) * 6.0)) * 0.22 * fbm(v_p * 30.0 + 3.0);
  float foam = sea * wind * (caps * 0.75 + swell);
  // coast: sea next to land breaks into surf; low land next to the sea floods
  float near = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785;
    near += texture2D(u_mask, uv + vec2(cos(a), sin(a)) * u_texel * 2.5).r;
  }
  near /= 8.0;
  float surfZone = sea * (1.0 - near) * 4.0;               // sea cells with land around
  float surf = clamp(surfZone, 0.0, 1.0) * wind * (0.5 + 0.5 * sin(u_time * 3.0 - r * 300.0));
  float surge = (1.0 - sea) * low * clamp(near * 2.5, 0.0, 1.0) * wind;
  float aFoam = clamp(foam * 0.7 + surf * 0.9, 0.0, 0.9);
  // storm surge: murky sea water over the low shore
  vec3 surgeCol = vec3(0.30, 0.38, 0.40) + 0.15 * fbm(v_p * 300.0 + u_time * 0.3);
  float aSurge = surge * 0.8;
  // premultiplied: white foam over the surge water
  vec3 col = vec3(0.93, 0.95, 0.97) * aFoam + surgeCol * aSurge * (1.0 - aFoam);
  gl_FragColor = vec4(col, aFoam + aSurge * (1.0 - aFoam));
}`;

/* ---------------------------------------------------------------- GL */
let gl = null, prog = {}, buf = {};
function compile(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('[coastal3d] ' + gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(vs, gl.VERTEX_SHADER)); gl.attachShader(p, compile(fs, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[coastal3d] ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u, a: Object.fromEntries(attribs.map((k) => [k, gl.getAttribLocation(p, k)])) };
}
function onAdd(m, context) {
  try { setup(context); } catch (err) { gl = null; console.error('[coastal3d] setup failed:', err.message); }
}
function setup(context) {
  gl = context;
  prog.cloud = program(CLOUD_VS, CLOUD_FS, ['a_pos']);
  prog.rain = program(RAIN_VS, RAIN_FS, ['a_seed']);
  prog.sea = program(SEA_VS, SEA_FS, ['a_xy']);
  const q = [];
  for (let l = 0; l < CLOUD_SLICES; l++) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) q.push(x, y, l);   // bottom to top
  buf.cloud = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.cloud); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q), gl.STATIC_DRAW);
  buf.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  const seeds = new Float32Array(MAX_DROPS * 8);
  for (let i = 0; i < MAX_DROPS; i++) {
    const a = Math.random(), r = Math.random(), ph = Math.random();
    seeds.set([a, r, ph, 0, a, r, ph, 1], i * 8);
  }
  buf.rain = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.rain); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  state.cells.forEach((c) => { c.mask = null; });
}
function onRemove() { gl = null; prog = {}; buf = {}; state.cells.forEach((c) => { c.mask = null; }); }

/* ---------------------------------------------------------------- sea mask from the terrain */
function buildMask(cell) {
  const { R } = SEVERITY[cell.severity] || SEVERITY.Medium;
  const lat = cell.lngLat[1], mx = 111320 * Math.cos((lat * Math.PI) / 180), my = 110540;
  const half = R * 1.1, data = new Uint8Array(MASK_N * MASK_N * 4);
  let missing = false;
  for (let j = 0; j < MASK_N; j++) {
    for (let i = 0; i < MASK_N; i++) {
      const x = ((i + 0.5) / MASK_N * 2 - 1) * half, y = ((j + 0.5) / MASK_N * 2 - 1) * half;
      const e = map.queryTerrainElevation([cell.lngLat[0] + x / mx, cell.lngLat[1] + y / my], { exaggerated: true });
      if (e == null) missing = true;
      const h = e == null ? 1 : e;
      const o = (j * MASK_N + i) * 4;
      data[o] = h <= 0.5 ? 255 : 0;                    // sea
      data[o + 1] = h > 0.5 && h < SURGE_LAND_M ? 255 : 0;   // low shore the surge reaches
      data[o + 3] = 255;
    }
  }
  if (!cell.mask) cell.mask = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, cell.mask);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MASK_N, MASK_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  cell.rebuildAt = missing ? performance.now() + 1500 : Infinity;
}

/* ---------------------------------------------------------------- lightning flashes in the bands */
const FLICKER = [1, 0.3, 0.9, 0.2, 0.6, 0.25, 0];
function flash(cell, now) {
  if (cell.strike && now - cell.strike.at > 0.45) cell.strike = null;
  if (!cell.strike && now >= (cell.next || 0)) {
    const a = Math.random() * Math.PI * 2, r = 0.08 + Math.random() * 0.6;
    cell.strike = { at: now, x: Math.cos(a) * r, y: Math.sin(a) * r };
    cell.next = now + 0.8 + Math.random() * 2.5;
  }
  if (!cell.strike) return [0, 0, 0];
  const t = (now - cell.strike.at) / 0.065, i = Math.floor(t);
  const b = i >= FLICKER.length - 1 ? 0 : FLICKER[i] + (FLICKER[i + 1] - FLICKER[i]) * (t - i);
  return [cell.strike.x, cell.strike.y, b];
}

/* ---------------------------------------------------------------- drawing */
function translated(matrix, merc) {
  const m = Array.from(matrix), out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    out[r] = m[r]; out[4 + r] = m[4 + r]; out[8 + r] = m[8 + r];
    out[12 + r] = m[r] * merc.x + m[4 + r] * merc.y + m[8 + r] * merc.z + m[12 + r];
  }
  return out;
}
let lastError = '';
function render(_gl, matrix) {
  try { draw(matrix); } catch (err) {
    if (String(err) !== lastError) { lastError = String(err); console.error('[coastal3d]', err); }
  }
}
function draw(matrix) {
  if (!gl || !state.cells.length || map.getZoom() < MIN_ZOOM) return;
  const now = performance.now(), { clientWidth: w, clientHeight: h } = map.getCanvas();
  const zoom = map.getZoom(), pitch = map.getPitch();
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  for (const cell of state.cells) {
    const { R, k } = SEVERITY[cell.severity] || SEVERITY.Medium;
    const px = map.project(cell.lngLat), reach = (R / (40075016 * Math.cos(cell.lngLat[1] * Math.PI / 180) / 2 ** zoom / 512)) * 1.2;
    if (px.x < -reach || px.x > w + reach || px.y < -reach || px.y > h + reach) continue;   // storm entirely off screen
    if (!cell.mask || now > cell.rebuildAt) buildMask(cell);
    const merc = window.mapboxgl.MercatorCoordinate.fromLngLat(cell.lngLat, 0);   // sea level
    const mpm = merc.meterInMercatorCoordinateUnits(), M = translated(matrix, merc);
    const t = now / 1000 + cell.phase;

    // sea surface
    let p = prog.sea;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.u_matrix, false, M); gl.uniform1f(p.u.u_mpm, mpm); gl.uniform1f(p.u.u_R, R);
    gl.uniform1f(p.u.u_time, t); gl.uniform1f(p.u.u_texel, 1 / MASK_N);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cell.mask); gl.uniform1i(p.u.u_mask, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.quad);
    gl.enableVertexAttribArray(p.a.a_xy); gl.vertexAttribPointer(p.a.a_xy, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(p.a.a_xy);

    // rain under the bands (only worth drawing once streaks are big enough to see)
    if (zoom > 7.5) {
      p = prog.rain;
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.u_matrix, false, M); gl.uniform1f(p.u.u_mpm, mpm); gl.uniform1f(p.u.u_R, R); gl.uniform1f(p.u.u_time, t);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.rain);
      gl.enableVertexAttribArray(p.a.a_seed); gl.vertexAttribPointer(p.a.a_seed, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, Math.round(MAX_DROPS * k) * 2);
      gl.disableVertexAttribArray(p.a.a_seed);
    }

    // spiral cloud bands; thinner when tilted low or zoomed in under them, so the map stays usable
    p = prog.cloud;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.u_matrix, false, M); gl.uniform1f(p.u.u_mpm, mpm); gl.uniform1f(p.u.u_R, R);
    gl.uniform1f(p.u.u_time, t); gl.uniform1f(p.u.u_density, k);
    const veil = Math.min(1, Math.max(0.5, 1 - (zoom - 9) * 0.15));
    gl.uniform1f(p.u.u_veil, veil);
    gl.uniform1f(p.u.u_tilt, 1 + 2.2 * Math.min(1, Math.max(0, (pitch - 40) / 40)));
    gl.uniform3f(p.u.u_flash, ...flash(cell, t));
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.cloud);
    gl.enableVertexAttribArray(p.a.a_pos); gl.vertexAttribPointer(p.a.a_pos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6 * CLOUD_SLICES);
    gl.disableVertexAttribArray(p.a.a_pos);
  }
  gl.depthMask(true);
  map.triggerRepaint();              // keep it turning
}

/* ---------------------------------------------------------------- layer lifecycle */
// the 3D effect layers may sit above each other; anything else goes below
const FX_LAYERS = ['storm3d', 'fire3d', 'landslide3d', 'coastal3d', 'hazards3d'];
let retry = 0, movedAbove = '';
function ensureLayer() {
  if (!map || !map.getStyle()) return;
  if (map.getLayer(LAYER_ID)) {
    const order = map.style && map.style._order;
    const layers = map.getStyle().layers, top = layers.length ? layers[layers.length - 1].id : '';
    const onTop = order ? order.slice(order.indexOf(LAYER_ID) + 1).every((id) => FX_LAYERS.includes(id)) : top === movedAbove;
    if (!onTop) { map.moveLayer(LAYER_ID); movedAbove = top; }
    return;
  }
  try { map.addLayer({ id: LAYER_ID, type: 'custom', renderingMode: '3d', onAdd, onRemove, render }); }
  catch (err) { clearTimeout(retry); retry = setTimeout(ensureLayer, 250); }
}

const coastal3d = {
  setCells(list) {
    const old = new Map(state.cells.map((c) => [c.id, c]));
    state.cells = list.map((c) => old.get(c.id) || { ...c, phase: Math.random() * 100 });
    ensureLayer(); map && map.triggerRepaint();
  },
  addCell(cell) { if (!state.cells.some((c) => c.id === cell.id)) this.setCells([...state.cells, cell]); },
  clearCells() { state.cells = []; map && map.triggerRepaint(); },
  /* for the console: cyclones and whether their sea mask is built */
  status: () => state.cells.map((c) => ({ id: c.id, severity: c.severity, mask: !!c.mask, gl: !!gl })),
};

(function boot() {
  // window.map is the #map <div> until app.js replaces it with the Mapbox map
  if (!window.mapboxgl || !window.map || typeof window.map.getStyle !== 'function') { setTimeout(boot, 150); return; }
  map = window.map;
  window.coastal3d = coastal3d;
  map.on('style.load', ensureLayer);
  map.on('styledata', ensureLayer);
  // the sea mask comes from the terrain tiles: redo it when more detailed ones arrive
  let pending = 0;
  map.on('sourcedata', (e) => {
    if (e.sourceId !== 'dem' || !e.tile || !state.cells.length) return;
    clearTimeout(pending);
    pending = setTimeout(() => { state.cells.forEach((c) => { c.rebuildAt = 0; }); map.triggerRepaint(); }, 400);
  });
  ensureLayer();
})();
