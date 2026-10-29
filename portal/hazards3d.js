/* 3D effects for four more hazard types, drawn in world space by one Mapbox
   custom layer (like storm3d.js / fire3d.js / landslide3d.js / coastal3d.js),
   at real size on the terrain:

   - snow:  snowfall from a low cloud deck, flakes drifting and swaying in the
            wind, a snow blanket on the ground and blowing snow along it
   - glof:  a glacial lake bursting: silty meltwater racing down the real
            valley (traced downhill over the terrain), white foam and spray
   - smog:  a thick, low brown-grey haze lying over the city and drifting
   - heat:  a heatwave: pulsing hot ground and shimmering heat haze rising

   setCells([{ id, kind, lngLat, severity }]) puts one effect on each site
   (effects.js registers them). Sizes are in metres and every particle is
   placed on the terrain, so the effects scale with the map like the land. */

let map = null;
const LAYER_ID = 'hazards3d';
const PATH_N = 48;
const KIND = {
  snow: { minZoom: 8, R: { 'Very High': 8000, High: 6000, Medium: 4000, Low: 3000 } },
  glof: { minZoom: 8, R: { 'Very High': 12000, High: 8000, Medium: 6000, Low: 4000 } },   // R = flood length
  smog: { minZoom: 6.5, R: { 'Very High': 25000, High: 18000, Medium: 12000, Low: 8000 } },
  heat: { minZoom: 5.5, R: { 'Very High': 30000, High: 22000, Medium: 15000, Low: 10000 } },
};
const SHARE = { 'Very High': 1, High: 0.8, Medium: 0.6, Low: 0.45 };
// particle kinds (u_kind) and counts at full severity
const P = {
  flake: 0, snowGround: 1, drift: 2, water: 3, spray: 4, lake: 5, smog: 6, heatGround: 7, shimmer: 8, snowCloud: 9,
};
const FLAT = new Set([P.snowGround, P.water, P.lake, P.heatGround, P.snowCloud]);   // lie flat (world-size quads)
const COUNTS = {
  snow: { [P.snowCloud]: 110, [P.snowGround]: 1100, [P.drift]: 200, [P.flake]: 8000 },
  glof: { [P.lake]: 70, [P.water]: 1100, [P.spray]: 520 },
  smog: { [P.smog]: 1100 },
  heat: { [P.heatGround]: 260, [P.shimmer]: 600 },
};
const SNOW_H = 1600, SNOW_CLOUD_H = 1900, WIND = [0.6, 0.25];

const state = { cells: [] };

/* ---------------------------------------------------------------- shaders */
const VS = `
precision highp float;
attribute vec3 a_base;               // ground spot (local m, z = ground height) — path movers: (lateral, 0, 0)
attribute vec4 a_seed;
attribute vec2 a_corner;             // -1..1
uniform mat4 u_matrix;
uniform float u_mpm, u_time, u_focal, u_kind, u_minpx, u_width;
uniform vec3 u_eye;
uniform vec2 u_half, u_wind;
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
bool isKind(float k) { return abs(u_kind - k) < 0.5; }
void main() {
  float s1 = a_seed.x, s2 = a_seed.y, s3 = a_seed.z, s4 = a_seed.w;
  v_uv = a_corner;
  v_shade = s3;
  vec3 p = a_base;
  float size = 10.0, aspect = 1.0, alpha = 1.0, ang = s1 * 6.2832;
  bool onGround = false;
  if (isKind(${P.flake}.0)) {                           // snowflake: falls from the cloud, sways, drifts downwind
    float f = fract(s1 + u_time / (16.0 + 10.0 * s2));
    float h = ${SNOW_H.toFixed(1)} * (1.0 - f);
    p += vec3(u_wind * (1.0 - f) * 500.0 + vec2(sin(u_time * 1.3 + s4 * 30.0), cos(u_time * 1.1 + s3 * 30.0)) * 14.0, h + 3.0);
    size = 7.0 + 9.0 * s4;
    alpha = smoothstep(0.0, 0.08, f) * smoothstep(1.0, 0.94, f);
  } else if (isKind(${P.snowGround}.0)) {              // snow blanket
    onGround = true; size = 220.0 + 260.0 * s2; p.z += 4.0; alpha = 0.42;
  } else if (isKind(${P.drift}.0)) {                    // blowing snow skimming the ground
    float f = fract(s1 + u_time * 0.07);
    p += vec3(u_wind * f * 700.0, 15.0 + 25.0 * s2);
    size = 70.0 + 110.0 * s4;
    alpha = sin(3.14159 * f) * 0.28;
  } else if (isKind(${P.snowCloud}.0)) {               // low snow cloud deck
    onGround = true; size = 900.0 + 900.0 * s2;
    p.z = ${SNOW_CLOUD_H.toFixed(1)} + 200.0 * s3;
    alpha = 0.45;
  } else if (isKind(${P.water}.0) || isKind(${P.spray}.0)) {   // GLOF flood water racing down the valley
    float speed = isKind(${P.water}.0) ? 0.035 + 0.02 * s2 : 0.05 + 0.03 * s2;
    float t = fract(s1 + u_time * speed);
    vec3 c0 = pathAt(t), c1 = pathAt(t + 0.01);
    vec2 dir = normalize(c1.xy - c0.xy + vec2(1e-4, 0.0));
    vec2 side = vec2(-dir.y, dir.x);
    float w = u_width * (0.7 + 0.5 * t);
    float lat = a_base.x * w * 0.5;
    // a flood fills the gorge: water further from the channel centre rides up the valley walls
    p = c0 + vec3(side * lat, 12.0 + abs(lat) * 0.45);
    if (isKind(${P.water}.0)) {
      onGround = true; size = 110.0 + 90.0 * s4; ang = atan(dir.y, dir.x); aspect = 0.6; p.z += 6.0;
      alpha = 0.85 * smoothstep(0.0, 0.03, t);
    } else {
      float life = fract(s3 + u_time * 0.9);
      p.z += 8.0 + life * 45.0;
      size = 25.0 + 45.0 * s4 * (0.5 + life);
      alpha = sin(3.14159 * life) * 0.55;
    }
  } else if (isKind(${P.lake}.0)) {                     // the burst glacial lake at the head of the valley
    onGround = true; size = 160.0 + 140.0 * s2; p.z += 3.0; alpha = 0.85;
  } else if (isKind(${P.smog}.0)) {                     // smog: big low sheets of haze drifting slowly
    float drift = u_time * (6.0 + 6.0 * s2);
    p += vec3(u_wind * mod(drift + s4 * 3000.0, 3000.0) - u_wind * 1500.0, 60.0 + 320.0 * s2);
    size = 900.0 + 1500.0 * s4;
    alpha = 0.34 + 0.1 * sin(u_time * 0.2 + s1 * 20.0);
  } else if (isKind(${P.heatGround}.0)) {              // hot ground, pulsing
    onGround = true; size = 1800.0 + 2600.0 * s2; p.z += 5.0;
    alpha = 0.30 + 0.10 * sin(u_time * (0.6 + 0.5 * s3) + s4 * 6.3);
  } else {                                              // heat shimmer: wavering columns of hot air rising
    float f = fract(s1 + u_time / (6.0 + 5.0 * s2));
    p.z += 20.0 + f * 260.0;
    size = 160.0 + 220.0 * s4; aspect = 2.6;
    alpha = sin(3.14159 * f) * 0.8;
  }
  float dist = max(length(p - u_eye), 1.0);
  if (onGround) {
    // a quad lying on the ground (or the cloud deck), sized in metres
    vec2 c = vec2(a_corner.x * size, a_corner.y * size * aspect);
    c = vec2(cos(ang) * c.x - sin(ang) * c.y, sin(ang) * c.x + cos(ang) * c.y);
    p.xy += c;
    p.z += dist * 0.004;                                // coarse far terrain must not swallow it
    gl_Position = u_matrix * vec4(p.x * u_mpm, -p.y * u_mpm, p.z * u_mpm, 1.0);
  } else {
    p.z += dist * 0.003;
    vec4 c = u_matrix * vec4(p.x * u_mpm, -p.y * u_mpm, p.z * u_mpm, 1.0);
    float px = max(size * u_focal / dist, u_minpx);
    c.xy += a_corner * vec2(px, px * aspect) / u_half * c.w;
    gl_Position = c;
  }
  v_alpha = alpha;
}`;
const FS = `
precision highp float;                 // must match the vertex shader for the shared uniforms
uniform float u_kind, u_fade, u_time;
varying vec2 v_uv;
varying float v_alpha, v_shade;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
bool isKind(float k) { return abs(u_kind - k) < 0.5; }
void main() {
  vec2 uv = v_uv;
  float r = length(uv), a = 0.0;
  vec3 col = vec3(1.0);
  float soft = pow(max(0.0, 1.0 - r * r), 2.0);
  float n = vnoise(uv * 2.5 + v_shade * 19.0);
  if (isKind(${P.flake}.0)) { a = smoothstep(1.0, 0.2, r); col = vec3(0.97, 0.98, 1.0); }
  else if (isKind(${P.snowGround}.0)) { a = smoothstep(1.0, 0.4, r + (n - 0.5) * 0.5); col = mix(vec3(0.86, 0.89, 0.93), vec3(0.98, 0.99, 1.0), n); }
  else if (isKind(${P.drift}.0)) { a = soft * n; col = vec3(0.93, 0.95, 0.98); }
  else if (isKind(${P.snowCloud}.0)) { a = soft * smoothstep(0.25, 0.75, n); col = mix(vec3(0.62, 0.65, 0.70), vec3(0.88, 0.9, 0.93), n); }
  else if (isKind(${P.water}.0)) {
    // silty glacial meltwater, white where it churns
    a = smoothstep(1.0, 0.5, r + (n - 0.5) * 0.4);
    float foam = smoothstep(0.62, 0.85, vnoise(uv * 4.0 + vec2(u_time * 3.0, v_shade * 13.0)));
    col = mix(mix(vec3(0.47, 0.46, 0.40), vec3(0.62, 0.58, 0.48), n), vec3(0.93, 0.95, 0.95), foam);   // silty grey-brown
  }
  else if (isKind(${P.spray}.0)) { a = soft * 0.9; col = vec3(0.92, 0.95, 0.97); }
  else if (isKind(${P.lake}.0)) { a = smoothstep(1.0, 0.5, r + (n - 0.5) * 0.4); col = mix(vec3(0.18, 0.55, 0.62), vec3(0.42, 0.75, 0.78), n); }
  else if (isKind(${P.smog}.0)) { a = soft * (0.65 + 0.35 * n); col = mix(vec3(0.50, 0.47, 0.40), vec3(0.66, 0.63, 0.56), n); }   // brown-grey murk
  else if (isKind(${P.heatGround}.0)) { a = soft * (0.7 + 0.3 * n); col = mix(vec3(0.85, 0.18, 0.04), vec3(1.0, 0.48, 0.10), n); }
  else {
    // shimmer: thin wavering bands, brightest in the middle of the column
    float wave = 0.5 + 0.5 * sin(uv.y * 14.0 + sin(uv.x * 6.0 + u_time * 4.0 + v_shade * 9.0) * 2.0 - u_time * 5.0);
    a = smoothstep(1.0, 0.0, abs(uv.x)) * smoothstep(1.0, 0.3, abs(uv.y)) * wave * 0.35;
    col = vec3(1.0, 0.86, 0.62);
  }
  a *= v_alpha * u_fade;
  gl_FragColor = vec4(col * a, a);
}`;

/* ---------------------------------------------------------------- GL */
let gl = null, prog = null;
function compile(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('[hazards3d] ' + gl.getShaderInfoLog(s));
  return s;
}
function onAdd(m, context) {
  try { setup(context); } catch (err) { gl = null; console.error('[hazards3d] setup failed:', err.message); }
}
function setup(context) {
  gl = context;
  const p = gl.createProgram();
  gl.attachShader(p, compile(VS, gl.VERTEX_SHADER)); gl.attachShader(p, compile(FS, gl.FRAGMENT_SHADER));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[hazards3d] ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name); }
  prog = { p, u, a: { base: gl.getAttribLocation(p, 'a_base'), seed: gl.getAttribLocation(p, 'a_seed'), corner: gl.getAttribLocation(p, 'a_corner') } };
  state.cells.forEach((c) => { c.buffers = null; });
}
function onRemove() { gl = null; prog = null; state.cells.forEach((c) => { c.buffers = null; }); }

/* ---------------------------------------------------------------- building a site */
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
function elevation(lngLat) {
  const e = map.queryTerrainElevation && map.queryTerrainElevation(lngLat, { exaggerated: true });
  return e == null ? null : e;
}
/* GLOF: from the lake, walk the steepest way down the valley, keeping momentum */
function traceValley(at, L) {
  const STEP = 80;
  let best = 0, drop = -Infinity;
  const e0 = at(0, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, e = at(Math.cos(a) * 300, Math.sin(a) * 300);
    if (e != null && e0 - e > drop) { drop = e0 - e; best = a; }
  }
  let x = 0, y = 0, heading = best;
  const pts = [];
  for (let walked = 0; walked <= L; walked += STEP) {
    const e = at(x, y);
    if (e == null) return null;
    pts.push([x, y, e]);
    let pick = heading, low = Infinity;
    for (let k = -4; k <= 4; k++) {
      const a = heading + (k * Math.PI) / 16;
      const en = at(x + Math.cos(a) * STEP * 2, y + Math.sin(a) * STEP * 2);
      if (en != null && en + Math.abs(k) * 0.5 < low) { low = en + Math.abs(k) * 0.5; pick = a; }
    }
    heading = heading * 0.5 + pick * 0.5;
    x += Math.cos(heading) * STEP; y += Math.sin(heading) * STEP;
  }
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
  return out;
}
function buildCell(cell) {
  const spec = KIND[cell.kind], R = spec.R[cell.severity] || spec.R.Medium, k = SHARE[cell.severity] || 0.6;
  const lat = cell.lngLat[1], mx = 111320 * Math.cos((lat * Math.PI) / 180), my = 110540;
  const at = (x, y) => elevation([cell.lngLat[0] + x / mx, cell.lngLat[1] + y / my]);
  const e0 = at(0, 0);
  if (e0 == null) { cell.rebuildAt = performance.now() + 1500; return; }
  let missing = false;
  const ground = (x, y) => { const e = at(x, y); if (e == null) { missing = true; return 0; } return e - e0; };
  const disc = (radius, landOnly = false) => () => {
    for (let tries = 0; ; tries++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      const x = Math.cos(a) * r, y = Math.sin(a) * r, e = at(x, y);
      // hot ground is land: try again if this spot is sea (a few tries, then accept)
      if (landOnly && e != null && e <= 0.5 && tries < 12) continue;
      return [x, y, ground(x, y)];
    }
  };
  const make = (count, place) => {
    const v = new Float32Array(count * 6 * 9);
    for (let i = 0, o = 0; i < count; i++) {
      const base = place(), s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (const cr of CORNERS) { v.set([...base, ...s, ...cr], o); o += 9; }
    }
    return v;
  };
  const data = {};
  const n = (kind) => Math.round(COUNTS[cell.kind][kind] * k);
  if (cell.kind === 'snow') {
    data[P.snowCloud] = make(n(P.snowCloud), () => { const [x, y] = disc(R * 1.1)(); return [x, y, 0]; });
    data[P.snowGround] = make(n(P.snowGround), disc(R));
    data[P.drift] = make(n(P.drift), disc(R));
    data[P.flake] = make(n(P.flake), disc(R));
  } else if (cell.kind === 'glof') {
    const path = traceValley(at, R);
    if (!path) { cell.rebuildAt = performance.now() + 1500; return; }
    path.forEach((pt) => { pt[2] -= e0; });
    cell.path = new Float32Array(path.flat());
    cell.width = R > 10000 ? 520 : 400;
    data[P.lake] = make(n(P.lake), disc(450));
    const lateral = () => [(Math.random() - 0.5) * 2 * Math.sqrt(Math.random()), 0, 0];
    data[P.water] = make(n(P.water), lateral);
    data[P.spray] = make(n(P.spray), lateral);
  } else if (cell.kind === 'smog') {
    data[P.smog] = make(n(P.smog), disc(R));
  } else {
    data[P.heatGround] = make(n(P.heatGround), disc(R * 0.9, true));
    data[P.shimmer] = make(n(P.shimmer), disc(R * 0.8, true));
  }
  if (cell.buffers) Object.values(cell.buffers).forEach((x) => gl.deleteBuffer(x.b));
  cell.buffers = Object.entries(data).map(([kind, arr]) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    return { kind: +kind, b, n: arr.length / 9 };
  });
  cell.elev = e0;
  cell.R = R;
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
const MINPX = { [P.flake]: 1.2, [P.drift]: 2, [P.spray]: 1.2, [P.smog]: 4, [P.shimmer]: 1.5 };
let lastError = '';
function render(_gl, matrix) {
  try { draw(matrix); } catch (err) {
    if (String(err) !== lastError) { lastError = String(err); console.error('[hazards3d]', err); }
  }
}
function draw(matrix) {
  if (!gl || !state.cells.length) return;
  const now = performance.now(), zoom = map.getZoom(), { clientWidth: w, clientHeight: h } = map.getCanvas();
  const mpp = (lat) => 40075016 * Math.cos((lat * Math.PI) / 180) / 2 ** zoom / 512;
  const live = state.cells.filter((cell) => {
    if (zoom < KIND[cell.kind].minZoom) return false;
    const R = KIND[cell.kind].R[cell.severity] || KIND[cell.kind].R.Medium;
    const px = map.project(cell.lngLat), reach = R / mpp(cell.lngLat[1]) * 1.2;
    return px.x > -reach && px.x < w + reach && px.y > -reach && px.y < h + reach;
  });
  if (!live.length) return;
  const pos = map.getFreeCameraOptions().position;
  const half = [gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2];
  const focal = half[1] / Math.tan(((map.transform && map.transform.fov) || 36.87) * Math.PI / 360);

  gl.useProgram(prog.p);
  gl.enableVertexAttribArray(prog.a.base); gl.enableVertexAttribArray(prog.a.seed); gl.enableVertexAttribArray(prog.a.corner);
  gl.enable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
  gl.uniform1f(prog.u.u_focal, focal);
  gl.uniform2f(prog.u.u_half, half[0], half[1]);
  gl.uniform2f(prog.u.u_wind, WIND[0], WIND[1]);
  for (const cell of live) {
    if (now > (cell.rebuildAt ?? 0)) buildCell(cell);                     // first time, or detailed terrain arrived
    if (!cell.buffers) continue;
    const merc = window.mapboxgl.MercatorCoordinate.fromLngLat(cell.lngLat, cell.elev);
    const mpm = merc.meterInMercatorCoordinateUnits();
    gl.uniformMatrix4fv(prog.u.u_matrix, false, translated(matrix, merc));
    gl.uniform1f(prog.u.u_mpm, mpm);
    gl.uniform3f(prog.u.u_eye, (pos.x - merc.x) / mpm, (merc.y - pos.y) / mpm, (pos.z - merc.z) / mpm);
    gl.uniform1f(prog.u.u_time, now / 1000 + cell.phase);
    gl.uniform1f(prog.u.u_fade, Math.min(1, zoom - KIND[cell.kind].minZoom));
    if (cell.path) { gl.uniform3fv(prog.u.u_path, cell.path); gl.uniform1f(prog.u.u_width, cell.width); }
    for (const buf of cell.buffers) {
      gl.uniform1f(prog.u.u_kind, buf.kind);
      gl.uniform1f(prog.u.u_minpx, MINPX[buf.kind] || 0);
      // heat shimmer adds light; everything else is ordinary see-through material
      if (buf.kind === P.shimmer) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
      gl.vertexAttribPointer(prog.a.base, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribPointer(prog.a.seed, 4, gl.FLOAT, false, 36, 12);
      gl.vertexAttribPointer(prog.a.corner, 2, gl.FLOAT, false, 36, 28);
      gl.drawArrays(gl.TRIANGLES, 0, buf.n);
    }
  }
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(true);
  gl.disableVertexAttribArray(prog.a.base); gl.disableVertexAttribArray(prog.a.seed); gl.disableVertexAttribArray(prog.a.corner);
  map.triggerRepaint();
}

/* ---------------------------------------------------------------- layer lifecycle */
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

const hazards3d = {
  setCells(list) {
    const old = new Map(state.cells.map((c) => [c.id, c]));
    state.cells = list.map((c) => old.get(c.id) || { ...c, phase: Math.random() * 100 });
    ensureLayer(); map && map.triggerRepaint();
  },
  addCell(cell) { if (!state.cells.some((c) => c.id === cell.id)) this.setCells([...state.cells, cell]); },
  /* remove one kind (e.g. 'snow') or, with no argument, everything */
  clearCells(kind) {
    state.cells = kind ? state.cells.filter((c) => c.kind !== kind) : [];
    map && map.triggerRepaint();
  },
  status: () => state.cells.map((c) => ({ id: c.id, kind: c.kind, severity: c.severity, built: !!c.buffers, gl: !!gl,
    drop: c.path ? Math.round(c.path[2] - c.path[c.path.length - 1]) : undefined })),
};

(function boot() {
  // window.map is the #map <div> until app.js replaces it with the Mapbox map
  if (!window.mapboxgl || !window.map || typeof window.map.getStyle !== 'function') { setTimeout(boot, 150); return; }
  map = window.map;
  window.hazards3d = hazards3d;
  map.on('style.load', ensureLayer);
  map.on('styledata', ensureLayer);
  // heights come from the terrain tiles: re-place everything when more detailed ones arrive
  let pending = 0;
  map.on('sourcedata', (e) => {
    if (e.sourceId !== 'dem' || !e.tile || !state.cells.length) return;
    clearTimeout(pending);
    pending = setTimeout(() => { state.cells.forEach((c) => { c.rebuildAt = 0; }); map.triggerRepaint(); }, 400);
  });
  ensureLayer();
})();
