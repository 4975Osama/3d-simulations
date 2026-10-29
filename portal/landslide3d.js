/* 3D landslide over the landslide hazard sites, drawn in world space by a
   Mapbox custom layer (like fire3d.js / storm3d.js): the slide follows the
   real terrain. From a source scar above the site it traces the steepest way
   down the DEM, so it bends into gullies like a real debris flow; along that
   path lies a scar of bare earth and mud flat on the slope, boulders and
   rubble keep pouring down it, and dust rises off the moving debris.

   setCells([{ id, lngLat, severity }]) puts one slide on each site
   (effects.js registers them). Sizes are real metres, so the slide scales
   with the map like the land under it. */

let map = null;
const LAYER_ID = 'landslide3d';
const MIN_ZOOM = 7;
const SEVERITY = {                 // path length (m), width (m), particle share
  'Very High': { L: 3000, W: 600, k: 1 },
  High: { L: 2200, W: 450, k: 0.85 },
  Medium: { L: 1500, W: 320, k: 0.7 },
  Low: { L: 1000, W: 220, k: 0.55 },
};
const COUNTS = { scar: 520, rock: 320, rubble: 760, dust: 180 };   // at k = 1
const PATH_N = 48;                 // points along the slide's centreline
const STEP_M = 40;                 // descent step when tracing it

const state = { cells: [] };

/* ---------------------------------------------------------------- shaders
   kinds: 0 scar (flat on the ground), 1 boulders, 2 rubble, 3 dust (billboards) */
const VS = `
precision highp float;
attribute vec3 a_base;               // scar: its spot (local m); movers: (lateral -1..1, 0, 0)
attribute vec4 a_seed;
attribute vec2 a_corner;
uniform mat4 u_matrix;
uniform float u_mpm, u_time, u_focal, u_kind, u_width, u_minpx;
uniform vec3 u_eye;
uniform vec2 u_half;
uniform vec3 u_path[${PATH_N}];
varying vec2 v_uv;
varying float v_alpha, v_shade;
vec3 pathAt(float t) {
  float f = clamp(t, 0.0, 0.9999) * ${(PATH_N - 1).toFixed(1)};
  int i = int(floor(f));
  vec3 a = u_path[0], b = u_path[1];
  for (int k = 0; k < ${PATH_N - 1}; k++) { if (k == i) { a = u_path[k]; b = u_path[k + 1]; } }
  return mix(a, b, fract(f));
}
float widthAt(float t) { return u_width * (0.55 + 0.45 * t + 0.9 * smoothstep(0.75, 1.0, t)); }   // fans out at the toe
void main() {
  float s1 = a_seed.x, s2 = a_seed.y, s3 = a_seed.z, s4 = a_seed.w;
  v_uv = a_corner;
  v_shade = s3;
  if (u_kind < 0.5) {                                   // scar: a flat patch lying on the slope
    float ang = s1 * 6.2832, size = (45.0 + 55.0 * s2);
    vec2 c = vec2(cos(ang) * a_corner.x - sin(ang) * a_corner.y, sin(ang) * a_corner.x + cos(ang) * a_corner.y) * size;
    vec3 p = a_base + vec3(c, 3.0);
    p.z += length(p - u_eye) * 0.004;                   // coarse far terrain must not swallow it
    v_alpha = 0.85;
    gl_Position = u_matrix * vec4(p.x * u_mpm, -p.y * u_mpm, p.z * u_mpm, 1.0);
    return;
  }
  // movers: travel down the path, spread across its width
  float speed = u_kind < 1.5 ? 0.06 + 0.05 * s2 : u_kind < 2.5 ? 0.09 + 0.07 * s2 : 0.05 + 0.03 * s2;
  float t = fract(s1 + u_time * speed);
  vec3 c0 = pathAt(t), c1 = pathAt(t + 0.02);
  vec2 dir = normalize(c1.xy - c0.xy + vec2(1e-4, 0.0));
  vec2 side = vec2(-dir.y, dir.x);
  vec3 p = c0 + vec3(side * a_base.x * widthAt(t) * 0.5, 0.0);
  float size, aspect = 1.0;
  if (u_kind < 1.5) {                                   // boulder: bouncing as it tumbles
    size = 10.0 + 18.0 * s4;
    p.z += size * 0.6 + abs(sin(u_time * (5.0 + 4.0 * s3) + s4 * 20.0)) * size * 0.8;
    v_alpha = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.9, t);
  } else if (u_kind < 2.5) {                            // rubble and mud clods
    size = 4.0 + 6.0 * s4;
    p.z += size + abs(sin(u_time * 9.0 + s4 * 30.0)) * 3.0;
    v_alpha = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.85, t);
  } else {                                              // dust: kicked up, rising and spreading
    float life = fract(s3 + u_time * 0.12);
    size = (60.0 + 220.0 * life) * (0.7 + 0.6 * s4);
    p += vec3(side * (s4 - 0.5) * 60.0 * life + vec2(25.0, 10.0) * life * 4.0, 10.0 + life * 160.0);
    v_alpha = sin(3.14159 * life) * 0.3 * smoothstep(0.0, 0.1, t);
  }
  float dist = max(length(p - u_eye), 1.0);
  p.z += dist * 0.004;                                  // coarse far terrain must not swallow it
  vec4 c = u_matrix * vec4(p.x * u_mpm, -p.y * u_mpm, p.z * u_mpm, 1.0);
  float px = max(size * u_focal / dist, u_minpx);
  c.xy += a_corner * vec2(px, px * aspect) / u_half * c.w;
  gl_Position = c;
}`;
const FS = `
precision highp float;                 // must match the vertex shader for the shared uniforms
uniform float u_kind, u_fade;
varying vec2 v_uv;
varying float v_alpha, v_shade;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 uv = v_uv;
  float r = length(uv);
  if (u_kind < 0.5) {                                   // bare earth / wet mud, ragged edge
    float n = vnoise(uv * 3.0 + v_shade * 17.0);
    float a = smoothstep(1.0, 0.45, r + (n - 0.5) * 0.5) * v_alpha * u_fade;
    vec3 col = mix(vec3(0.33, 0.24, 0.16), vec3(0.56, 0.46, 0.34), n * 0.7 + v_shade * 0.3);
    gl_FragColor = vec4(col * a, a);
  } else if (u_kind < 1.5) {                            // boulder: lumpy, lit from the top-left
    float n = vnoise(uv * 2.5 + v_shade * 9.0);
    float a = smoothstep(1.0, 0.8, r + (n - 0.5) * 0.35) * v_alpha * u_fade;
    float light = 0.65 + 0.35 * dot(normalize(vec3(uv, 0.8)), normalize(vec3(-0.5, 0.6, 0.6)));
    vec3 col = mix(vec3(0.22, 0.20, 0.18), vec3(0.52, 0.48, 0.42), v_shade) * light;   // grey-brown rock, contrasting with the mud
    gl_FragColor = vec4(col * a, a);
  } else if (u_kind < 2.5) {
    float a = smoothstep(1.0, 0.5, r) * v_alpha * u_fade;
    gl_FragColor = vec4(mix(vec3(0.20, 0.15, 0.10), vec3(0.50, 0.42, 0.32), v_shade) * a, a);
  } else {
    float a = pow(max(0.0, 1.0 - r * r), 2.0) * v_alpha * u_fade;
    gl_FragColor = vec4(vec3(0.62, 0.55, 0.45) * a, a);
  }
}`;

/* ---------------------------------------------------------------- GL */
let gl = null, prog = null;
function compile(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('[landslide3d] ' + gl.getShaderInfoLog(s));
  return s;
}
function onAdd(m, context) {
  try { setup(context); } catch (err) { gl = null; console.error('[landslide3d] setup failed:', err.message); }
}
function setup(context) {
  gl = context;
  const p = gl.createProgram();
  gl.attachShader(p, compile(VS, gl.VERTEX_SHADER)); gl.attachShader(p, compile(FS, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[landslide3d] ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, gl.getActiveUniform(p, i).name); }
  prog = { p, u, a: { base: gl.getAttribLocation(p, 'a_base'), seed: gl.getAttribLocation(p, 'a_seed'), corner: gl.getAttribLocation(p, 'a_corner') } };
  state.cells.forEach((c) => { c.buffers = null; });
}
function onRemove() { gl = null; prog = null; state.cells.forEach((c) => { c.buffers = null; }); }

/* ---------------------------------------------------------------- the slide path */
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
function elevation(lngLat) {
  const e = map.queryTerrainElevation && map.queryTerrainElevation(lngLat, { exaggerated: true });
  return e == null ? null : e;
}
/* trace the slide over the real terrain: climb from the site to the source
   scarp on the slope above it, then run the steepest way down through the
   site until the ground flattens out (the valley floor), where the debris
   stops and fans out. Turns are limited per step so the path keeps momentum
   instead of zigzagging. */
function walk(at, x, y, heading, maxLen, uphill, stopOnFlat) {
  const pts = [];
  let e = at(x, y), flat = 0;
  for (let walked = 0; walked <= maxLen && pts.length < 400; walked += STEP_M) {
    if (e == null) return null;
    pts.push([x, y, e]);
    let pick = heading, score = Infinity;
    for (let k = -3; k <= 3; k++) {                 // ±45° in 15° steps
      const a = heading + (k * Math.PI) / 12;
      const en = at(x + Math.cos(a) * STEP_M, y + Math.sin(a) * STEP_M);
      if (en == null) continue;
      const sc = (uphill ? -en : en) + Math.abs(k) * 0.3;
      if (sc < score) { score = sc; pick = a; }
    }
    heading = heading * 0.4 + pick * 0.6;
    x += Math.cos(heading) * STEP_M; y += Math.sin(heading) * STEP_M;
    const en = at(x, y);
    if (stopOnFlat && en != null && walked > maxLen * 0.4) {
      flat = e - en < STEP_M * 0.04 ? flat + 1 : 0;   // under ~2° of fall per step
      if (flat >= 3) { pts.push([x, y, en]); break; }
    }
    e = en;
  }
  return pts;
}
function tracePath(cell, L) {
  const lat = cell.lngLat[1], mx = 111320 * Math.cos((lat * Math.PI) / 180), my = 110540;
  const at = (x, y) => elevation([cell.lngLat[0] + x / mx, cell.lngLat[1] + y / my]);
  const e0 = at(0, 0);
  if (e0 == null) return null;
  // the slope's fall line at the site
  let best = 0, drop = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, e = at(Math.cos(a) * 200, Math.sin(a) * 200);
    if (e != null && e0 - e > drop) { drop = e0 - e; best = a; }
  }
  const up = walk(at, 0, 0, best + Math.PI, L * 0.4, true, false);      // to the scarp
  if (!up) return null;
  const top = up[up.length - 1];
  const fromTop = Math.atan2(-top[1], -top[0]);                          // back towards the site
  const pts = walk(at, top[0], top[1], fromTop, L, false, true);
  if (!pts || pts.length < 3) return null;
  pts.forEach((p) => { p[2] -= e0; });
  // resample to PATH_N evenly spaced points
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1, out = [];
  for (let k = 0, j = 0; k < PATH_N; k++) {
    const d = (k / (PATH_N - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const f = cum[j + 1] > cum[j] ? (d - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  return { path: out, e0, at };
}
function buildCell(cell) {
  const { L, W, k } = SEVERITY[cell.severity] || SEVERITY.Medium;
  const traced = tracePath(cell, L);
  if (!traced) { cell.rebuildAt = performance.now() + 1500; return; }   // terrain still loading
  const { path, e0, at } = traced;
  const pathAt = (t) => {
    const f = Math.min(0.9999, Math.max(0, t)) * (PATH_N - 1), i = Math.floor(f), g = f - i;
    const a = path[i], b = path[i + 1];
    return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g];
  };
  const widthAt = (t) => W * (0.55 + 0.45 * t + 0.9 * Math.max(0, Math.min(1, (t - 0.75) / 0.25)) ** 2);
  const make = (count, place) => {
    const v = new Float32Array(count * 6 * 9);
    for (let i = 0, o = 0; i < count; i++) {
      const base = place(), s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (const cr of CORNERS) { v.set([...base, ...s, ...cr], o); o += 9; }
    }
    return v;
  };
  // scar patches: placed on the CPU at their own ground height, so they lie on the slope
  let missing = false;
  const scar = make(Math.round(COUNTS.scar * k), () => {
    const t = Math.random(), c0 = pathAt(t), c1 = pathAt(t + 0.02);
    const dx = c1[0] - c0[0], dy = c1[1] - c0[1], l = Math.hypot(dx, dy) || 1;
    const lat = (Math.random() - 0.5) * widthAt(t) * 0.9;
    const x = c0[0] - (dy / l) * lat, y = c0[1] + (dx / l) * lat, e = at(x, y);
    if (e == null) missing = true;
    return [x, y, (e == null ? c0[2] + e0 : e) - e0];
  });
  const mover = (n) => make(Math.round(n * k), () => [(Math.random() - 0.5) * 2 * Math.random() ** 0.5, 0, 0]);
  const data = { 0: scar, 1: mover(COUNTS.rock), 2: mover(COUNTS.rubble), 3: mover(COUNTS.dust) };
  if (cell.buffers) Object.values(cell.buffers).forEach((x) => gl.deleteBuffer(x.b));
  cell.buffers = Object.fromEntries(Object.entries(data).map(([kind, arr]) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return [kind, { b, n: arr.length / 9 }];
  }));
  cell.path = new Float32Array(path.flat());
  cell.elev = e0;
  cell.width = W;
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
function drawKind(cell, kind, minpx) {
  const buf = cell.buffers[kind];
  if (!buf || !buf.n) return;
  gl.uniform1f(prog.u.u_kind, kind);
  gl.uniform1f(prog.u.u_minpx, minpx);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
  gl.vertexAttribPointer(prog.a.base, 3, gl.FLOAT, false, 36, 0);
  gl.vertexAttribPointer(prog.a.seed, 4, gl.FLOAT, false, 36, 12);
  gl.vertexAttribPointer(prog.a.corner, 2, gl.FLOAT, false, 36, 28);
  gl.drawArrays(gl.TRIANGLES, 0, buf.n);
}
let lastError = '';
function render(_gl, matrix) {
  try { draw(matrix); } catch (err) {
    if (String(err) !== lastError) { lastError = String(err); console.error('[landslide3d]', err); }
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

  gl.useProgram(prog.p);
  gl.enableVertexAttribArray(prog.a.base); gl.enableVertexAttribArray(prog.a.seed); gl.enableVertexAttribArray(prog.a.corner);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  gl.uniform1f(prog.u.u_focal, focal);
  gl.uniform2f(prog.u.u_half, half[0], half[1]);
  gl.uniform1f(prog.u.u_fade, Math.min(1, map.getZoom() - MIN_ZOOM));
  let drew = false;
  for (const cell of visible) {
    if ((!cell.buffers && now > (cell.rebuildAt || 0)) || now > cell.rebuildAt) buildCell(cell);
    if (!cell.buffers) continue;
    const merc = window.mapboxgl.MercatorCoordinate.fromLngLat(cell.lngLat, cell.elev);
    const mpm = merc.meterInMercatorCoordinateUnits();
    gl.uniformMatrix4fv(prog.u.u_matrix, false, translated(matrix, merc));
    gl.uniform1f(prog.u.u_mpm, mpm);
    gl.uniform3f(prog.u.u_eye, (pos.x - merc.x) / mpm, (merc.y - pos.y) / mpm, (pos.z - merc.z) / mpm);
    gl.uniform1f(prog.u.u_time, now / 1000 + cell.phase);
    gl.uniform1f(prog.u.u_width, cell.width);
    gl.uniform3fv(prog.u.u_path, cell.path);
    drawKind(cell, 0, 0);            // scar
    drawKind(cell, 2, 0.8);          // rubble
    drawKind(cell, 1, 1.2);          // boulders
    drawKind(cell, 3, 2);            // dust
    drew = true;
  }
  gl.depthMask(true);
  gl.disableVertexAttribArray(prog.a.base); gl.disableVertexAttribArray(prog.a.seed); gl.disableVertexAttribArray(prog.a.corner);
  map.triggerRepaint();              // keep it moving (and retry while terrain loads)
  return drew;
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

const landslide3d = {
  setCells(list) {
    const old = new Map(state.cells.map((c) => [c.id, c]));
    state.cells = list.map((c) => old.get(c.id) || { ...c, phase: Math.random() * 100 });
    ensureLayer(); map && map.triggerRepaint();
  },
  addCell(cell) { if (!state.cells.some((c) => c.id === cell.id)) this.setCells([...state.cells, cell]); },
  clearCells() { state.cells = []; map && map.triggerRepaint(); },
  /* for the console: which slides exist and whether their path has been traced */
  status: () => state.cells.map((c) => ({ id: c.id, severity: c.severity, built: !!c.buffers, gl: !!gl,
    drop: c.path ? Math.round(c.path[2] - c.path[c.path.length - 1]) : null })),
};

(function boot() {
  // window.map is the #map <div> until app.js replaces it with the Mapbox map
  if (!window.mapboxgl || !window.map || typeof window.map.getStyle !== 'function') { setTimeout(boot, 150); return; }
  map = window.map;
  window.landslide3d = landslide3d;
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
