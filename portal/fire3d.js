/* 3D wildfire over the fire hazard sites, drawn in world space by a Mapbox
   custom layer (like storm3d.js for floods): a burning area of real size
   that sits on the terrain, flickering flames thickest along the spreading
   fire front, an orange glow on the ground, embers rising out of it and a
   smoke column climbing a couple of kilometres and drifting downwind.

   setCells([{ id, lngLat, severity }]) puts one fire on each site
   (effects.js registers them). Every particle is a camera-facing billboard
   whose size is in metres, so the fire scales with the map like the land
   under it. Particle bases are sampled from the terrain, so on a hillside
   the flames sit on the slope. */

let map = null;
const LAYER_ID = 'fire3d';
const MIN_ZOOM = 6;
const SEVERITY = {                 // burning-area radius (m), particle share
  'Very High': { r: 2500, k: 1 },
  High: { r: 1800, k: 0.8 },
  Medium: { r: 1200, k: 0.6 },
  Low: { r: 800, k: 0.45 },
};
const COUNTS = { flame: 900, glow: 140, smoke: 170, ember: 380 };   // at k = 1
const SMOKE_H = 2200;              // smoke column height (m)
const WIND = [0.55, 0.2];          // drift per metre risen (east, north)

const state = { cells: [] };

/* ---------------------------------------------------------------- shaders
   one billboard program, four kinds: 0 flame, 1 ground glow, 2 smoke, 3 ember */
const VS = `
precision highp float;
attribute vec3 a_base;               // particle base, storm-local metres (x east, y north, z up)
attribute vec4 a_seed;
attribute vec2 a_corner;             // -1..1 billboard corner
uniform mat4 u_matrix;
uniform float u_mpm, u_time, u_focal, u_kind, u_minpx;
uniform vec3 u_eye;
uniform vec2 u_half, u_wind;
varying vec2 v_uv;
varying float v_alpha, v_heat;
void main() {
  vec3 p = a_base;
  float size = 0.0, aspect = 1.0, alpha = 1.0, heat = 1.0;
  float s1 = a_seed.x, s2 = a_seed.y, s3 = a_seed.z, s4 = a_seed.w;
  if (u_kind < 0.5) {                                   // flame: licks up and dies, flickering
    float t = fract(s1 + u_time * (0.7 + 0.9 * s2));
    float h = 30.0 + 70.0 * s3;
    p += vec3(sin(u_time * 3.0 + s4 * 20.0) * 4.0, cos(u_time * 2.3 + s1 * 17.0) * 4.0, t * h);
    size = (26.0 + 34.0 * s4) * (1.0 - 0.55 * t);
    aspect = 1.7;
    alpha = sin(3.14159 * t) * (0.55 + 0.45 * sin(u_time * 11.0 + s2 * 40.0));
    heat = 1.0 - t;
  } else if (u_kind < 1.5) {                            // glow on the burning ground
    p.z += 6.0;
    size = 140.0 + 200.0 * s4;
    alpha = 0.22 + 0.12 * sin(u_time * (2.5 + 3.0 * s1) + s2 * 6.3);
  } else if (u_kind < 2.5) {                            // smoke: rises, spreads, drifts, fades
    float t = fract(s1 + u_time / (22.0 + 12.0 * s2));
    float rise = t * ${SMOKE_H.toFixed(1)} * (0.75 + 0.5 * s3);
    p += vec3(u_wind * rise + vec2(sin(t * 6.0 + s4 * 9.0), cos(t * 5.0 + s3 * 7.0)) * 120.0 * t, rise);
    size = (160.0 + 1100.0 * t) * (0.7 + 0.6 * s4);
    alpha = smoothstep(0.0, 0.07, t) * pow(1.0 - t, 1.4) * 0.75;
    heat = 1.0 - smoothstep(0.0, 0.18, t);              // lit orange from below near the fire
  } else {                                              // ember: a spark carried up and away
    float t = fract(s1 + u_time / (2.5 + 2.5 * s2));
    float rise = t * (180.0 + 320.0 * s3);
    p += vec3(u_wind * rise * 0.6 + vec2(sin(t * 9.0 + s4 * 30.0), cos(t * 7.0 + s1 * 30.0)) * 25.0, rise);
    size = 5.0;
    alpha = (1.0 - t) * (0.5 + 0.5 * sin(u_time * 18.0 + s4 * 50.0));
  }
  float dist = max(length(p - u_eye), 1.0);
  // far away the terrain is drawn coarser and can swallow low flames: lift them a little with distance
  if (u_kind < 1.5 || u_kind > 2.5) p.z += dist * 0.005;
  vec4 c = u_matrix * vec4(p.x * u_mpm, -p.y * u_mpm, p.z * u_mpm, 1.0);
  float px = max(size * u_focal / dist, u_minpx);
  c.xy += a_corner * vec2(px, px * aspect) / u_half * c.w;
  gl_Position = c;
  v_uv = a_corner;
  v_alpha = alpha;
  v_heat = heat;
}`;
const FS = `
precision highp float;                 // must match the vertex shader for the shared uniforms
uniform float u_kind, u_fade;
varying vec2 v_uv;
varying float v_alpha, v_heat;
void main() {
  vec2 uv = v_uv;
  if (u_kind < 0.5) {                                   // teardrop flame: wide base, pointed tip
    float y = uv.y * 0.5 + 0.5;
    float w = mix(1.0, 0.25, y);
    float d = length(vec2(uv.x / w, (uv.y + 0.35) * 0.75));
    float a = smoothstep(1.0, 0.15, d) * v_alpha * u_fade;
    vec3 col = mix(vec3(0.75, 0.12, 0.02), vec3(1.0, 0.5, 0.08), v_heat);
    col = mix(col, vec3(1.0, 0.92, 0.6), smoothstep(0.55, 0.0, d) * v_heat);   // hot white-yellow core
    gl_FragColor = vec4(col * a, 0.0);
  } else if (u_kind < 1.5) {
    float a = exp(-dot(uv, uv) * 3.0) * v_alpha * u_fade;
    gl_FragColor = vec4(vec3(1.0, 0.33, 0.05) * a, 0.0);
  } else if (u_kind < 2.5) {
    float r2 = dot(uv, uv);
    float a = pow(max(0.0, 1.0 - r2), 2.0) * v_alpha * u_fade;
    vec3 col = mix(vec3(0.17, 0.16, 0.15), vec3(0.55, 0.25, 0.08), v_heat * 0.7);
    gl_FragColor = vec4(col * a, a);
  } else {
    float a = smoothstep(1.0, 0.0, length(uv)) * v_alpha * u_fade;
    gl_FragColor = vec4(vec3(1.0, 0.62, 0.2) * a, 0.0);
  }
}`;

/* ---------------------------------------------------------------- GL */
let gl = null, prog = null;
function compile(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('[fire3d] ' + gl.getShaderInfoLog(s));
  return s;
}
function onAdd(m, context) {
  try { setup(context); } catch (err) { gl = null; console.error('[fire3d] setup failed:', err.message); }
}
function setup(context) {
  gl = context;
  const p = gl.createProgram();
  gl.attachShader(p, compile(VS, gl.VERTEX_SHADER)); gl.attachShader(p, compile(FS, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[fire3d] ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  prog = { p, u, a: { base: gl.getAttribLocation(p, 'a_base'), seed: gl.getAttribLocation(p, 'a_seed'), corner: gl.getAttribLocation(p, 'a_corner') } };
  state.cells.forEach((c) => { c.buffers = null; });   // (re)build on this context
}
function onRemove() { gl = null; prog = null; state.cells.forEach((c) => { c.buffers = null; }); }

/* ---------------------------------------------------------------- particles */
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
const ground = (lngLat) => {
  const e = map.queryTerrainElevation && map.queryTerrainElevation(lngLat, { exaggerated: true });
  return e == null ? null : e;
};
/* a ragged fire perimeter: radius wobbles with angle, so it isn't a circle */
function perimeter(cell, a) {
  const w = cell.wobble;
  return 0.78 + 0.13 * Math.sin(a * 3 + w[0]) + 0.07 * Math.sin(a * 5 + w[1]) + 0.05 * Math.sin(a * 9 + w[2]);
}
function buildCell(cell) {
  const { r, k } = SEVERITY[cell.severity] || SEVERITY.Medium;
  const lat = cell.lngLat[1], mx = 111320 * Math.cos((lat * Math.PI) / 180), my = 110540;
  const c0 = ground(cell.lngLat);
  let missing = c0 == null;
  const elev0 = c0 || 0;
  const place = (x, y) => {
    const e = ground([cell.lngLat[0] + x / mx, cell.lngLat[1] + y / my]);
    if (e == null) { missing = true; return 0; }
    return e - elev0;
  };
  const make = (count, pick) => {
    const v = new Float32Array(count * 6 * 9);
    for (let i = 0, o = 0; i < count; i++) {
      const [x, y] = pick();
      const z = place(x, y), s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (const cr of CORNERS) { v.set([x, y, z, ...s, ...cr], o); o += 9; }
    }
    return v;
  };
  const inside = (front) => () => {
    const a = Math.random() * Math.PI * 2;
    // fronts: mostly near the perimeter; the rest scattered over the burning ground
    const f = front ? 0.82 + 0.18 * Math.random() : Math.sqrt(Math.random()) * 0.85;
    const rr = r * perimeter(cell, a) * f;
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  };
  const flameFront = Math.round(COUNTS.flame * k * 0.7), flameIn = Math.round(COUNTS.flame * k * 0.3);
  const flames = new Float32Array([...make(flameFront, inside(true)), ...make(flameIn, inside(false))]);
  const data = {
    0: flames,
    1: make(Math.round(COUNTS.glow * k), inside(false)),
    2: make(Math.round(COUNTS.smoke * k), inside(false)),
    3: make(Math.round(COUNTS.ember * k), inside(true)),
  };
  if (cell.buffers) Object.values(cell.buffers).forEach((x) => gl.deleteBuffer(x.b));
  cell.buffers = Object.fromEntries(Object.entries(data).map(([kind, arr]) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return [kind, { b, n: arr.length / 9 }];
  }));
  cell.elev = elev0;
  // terrain tiles still loading: rebuild in a moment so particles sit on the real ground
  cell.rebuildAt = missing ? performance.now() + 1500 : Infinity;
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
function drawKind(cell, kind) {
  const buf = cell.buffers[kind];
  if (!buf || !buf.n) return;
  gl.uniform1f(prog.u.u_kind, kind);
  gl.uniform1f(prog.u.u_minpx, kind === 1 ? 6 : kind === 2 ? 3 : kind === 0 ? 1.6 : 0.8);   // stay visible from afar
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
  gl.vertexAttribPointer(prog.a.base, 3, gl.FLOAT, false, 36, 0);
  gl.vertexAttribPointer(prog.a.seed, 4, gl.FLOAT, false, 36, 12);
  gl.vertexAttribPointer(prog.a.corner, 2, gl.FLOAT, false, 36, 28);
  gl.drawArrays(gl.TRIANGLES, 0, buf.n);
}
let lastError = '';
function render(_gl, matrix) {
  try { draw(matrix); } catch (err) {
    if (String(err) !== lastError) { lastError = String(err); console.error('[fire3d]', err); }
  }
}
function draw(matrix) {
  if (!gl || !state.cells.length || map.getZoom() < MIN_ZOOM) return;
  const now = performance.now(), { clientWidth: w, clientHeight: h } = map.getCanvas();
  const visible = state.cells.filter((cell) => {
    const px = map.project(cell.lngLat);
    return px.x > -w && px.x < 2 * w && px.y > -h && px.y < 2 * h;
  });
  if (!visible.length) return;
  const pos = map.getFreeCameraOptions().position;
  const half = [gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2];
  const focal = half[1] / Math.tan(((map.transform && map.transform.fov) || 36.87) * Math.PI / 360);
  // fade in over the first zoom level past MIN_ZOOM instead of popping
  const fade = Math.min(1, map.getZoom() - MIN_ZOOM);

  gl.useProgram(prog.p);
  gl.enableVertexAttribArray(prog.a.base); gl.enableVertexAttribArray(prog.a.seed); gl.enableVertexAttribArray(prog.a.corner);
  gl.enable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);   // hidden behind hills, never hides them
  gl.uniform1f(prog.u.u_time, now / 1000);
  gl.uniform1f(prog.u.u_focal, focal);
  gl.uniform2f(prog.u.u_half, half[0], half[1]);
  gl.uniform2f(prog.u.u_wind, WIND[0], WIND[1]);
  gl.uniform1f(prog.u.u_fade, fade);
  for (const cell of visible) {
    if (!cell.buffers || now > cell.rebuildAt) buildCell(cell);
    const merc = window.mapboxgl.MercatorCoordinate.fromLngLat(cell.lngLat, cell.elev);
    const mpm = merc.meterInMercatorCoordinateUnits();
    gl.uniformMatrix4fv(prog.u.u_matrix, false, translated(matrix, merc));
    gl.uniform1f(prog.u.u_mpm, mpm);
    gl.uniform3f(prog.u.u_eye, (pos.x - merc.x) / mpm, (merc.y - pos.y) / mpm, (pos.z - merc.z) / mpm);
    gl.uniform1f(prog.u.u_time, now / 1000 + cell.phase);
    gl.blendFunc(gl.ONE, gl.ONE); drawKind(cell, 1);                    // ground glow
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); drawKind(cell, 2);    // smoke
    gl.blendFunc(gl.ONE, gl.ONE); drawKind(cell, 0); drawKind(cell, 3); // flames, embers
  }
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(true);
  gl.disableVertexAttribArray(prog.a.base); gl.disableVertexAttribArray(prog.a.seed); gl.disableVertexAttribArray(prog.a.corner);
  map.triggerRepaint();                                                  // keep it burning
}

/* ---------------------------------------------------------------- layer lifecycle */
// the 3D effect layers (storm3d, fire3d, landslide3d) may sit above each other; anything else goes below
const FX_LAYERS = ['storm3d', 'fire3d', 'landslide3d', 'coastal3d', 'hazards3d'];
let retry = 0, movedAbove = '';
function ensureLayer() {
  if (!map || !map.getStyle()) return;
  if (map.getLayer(LAYER_ID)) {
    // stay above layers added later; getStyle() leaves custom layers out, so read the draw order
    const order = map.style && map.style._order;
    const layers = map.getStyle().layers, top = layers.length ? layers[layers.length - 1].id : '';
    const onTop = order ? order.slice(order.indexOf(LAYER_ID) + 1).every((id) => FX_LAYERS.includes(id)) : top === movedAbove;
    if (!onTop) { map.moveLayer(LAYER_ID); movedAbove = top; }
    return;
  }
  try { map.addLayer({ id: LAYER_ID, type: 'custom', renderingMode: '3d', onAdd, onRemove, render }); }
  catch (err) { clearTimeout(retry); retry = setTimeout(ensureLayer, 250); }
}

const fire3d = {
  setCells(list) {
    const old = new Map(state.cells.map((c) => [c.id, c]));
    state.cells = list.map((c) => old.get(c.id) || {
      ...c, phase: Math.random() * 100, wobble: [Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3],
    });
    ensureLayer(); map && map.triggerRepaint();
  },
  addCell(cell) { if (!state.cells.some((c) => c.id === cell.id)) this.setCells([...state.cells, cell]); },
  clearCells() { state.cells = []; map && map.triggerRepaint(); },
  /* for the console: what is burning and whether it has been built */
  status: () => state.cells.map((c) => ({ id: c.id, severity: c.severity, elev: c.elev, built: !!c.buffers, gl: !!gl })),
};

(function boot() {
  // window.map is the #map <div> until app.js replaces it with the Mapbox map
  if (!window.mapboxgl || !window.map || typeof window.map.getStyle !== 'function') { setTimeout(boot, 150); return; }
  map = window.map;
  window.fire3d = fire3d;
  map.on('style.load', ensureLayer);
  map.on('styledata', ensureLayer);
  // heights come from the terrain (DEM) tiles: the first ones to arrive are
  // coarse, so re-place everything whenever more detailed terrain has loaded
  let pending = 0;
  map.on('sourcedata', (e) => {
    if (e.sourceId !== 'dem' || !e.tile || !state.cells.length) return;
    clearTimeout(pending);
    pending = setTimeout(() => { state.cells.forEach((c) => { c.rebuildAt = 0; }); map.triggerRepaint(); }, 400);
  });
  ensureLayer();
})();
