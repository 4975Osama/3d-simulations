/* 3D effects for six more hazard types, drawn in world space by one Mapbox
   custom layer (like storm3d.js / fire3d.js / landslide3d.js / coastal3d.js),
   at real size on the terrain:

   - snow:  snow lying on the real land: deepest up high and on gentle ground,
            thin in the valleys, sliding off steep slopes (worked out from the
            terrain), blue in shadow, forests dusted rather than buried; flakes
            falling and swaying, snow blowing along the ground, and the haze of
            falling snow into the distance
   - glof:  a glacial lake bursting: silty meltwater racing down the real
            valley (traced downhill over the terrain), white foam and spray
   - smog:  a thick, low brown-grey haze lying over the city and drifting
   - heat:  a heatwave: the ground's heat as a thermal map draped on the
            terrain (hottest in the dense city, from the real WorldPop
            population grid: the urban heat island; cooler up the hills and
            over the sea), the land seen through wavering heat shimmer, and
            sun-baked light with a hot dusty haze thickening into the distance
   - drought: the land parched (green fields dried to tan and brown), cracked
            like a dried mud bed (the crack network at three scales, so it
            reads at every zoom), dust blowing across it in sheets, dust devils
            whirling up when the map is tilted, a dusty haze into the distance
   - quake: an earthquake on a loop: rupture at the epicentre, P waves (6 km/s)
            then the stronger S waves (3.5 km/s, real speeds, time-lapsed) run
            out as rings, shaking and rolling the land itself as they pass and
            dying away with distance, over a ShakeMap-style intensity field; the
            surface rupture tears open along the fault, and dust is thrown up

   setCells([{ id, kind, lngLat, severity }]) puts one effect on each site
   (effects.js registers them). Sizes are in metres and every particle is
   placed on the terrain, so the effects scale with the map like the land. */

let map = null;
const LAYER_ID = 'hazards3d';
const PATH_N = 48;
const KIND = {
  snow: { minZoom: 7.5, R: { 'Very High': 15000, High: 11000, Medium: 8000, Low: 5000 } },
  glof: { minZoom: 8, R: { 'Very High': 12000, High: 8000, Medium: 6000, Low: 4000 } },   // R = flood length
  smog: { minZoom: 6.5, R: { 'Very High': 25000, High: 18000, Medium: 12000, Low: 8000 } },
  heat: { minZoom: 5.5, R: { 'Very High': 30000, High: 22000, Medium: 15000, Low: 10000 } },
  drought: { minZoom: 5.5, R: { 'Very High': 45000, High: 35000, Medium: 25000, Low: 15000 } },
  quake: { minZoom: 6, R: { 'Very High': 40000, High: 30000, Medium: 20000, Low: 12000 } },   // R = strong-shaking radius
};
const SHARE = { 'Very High': 1, High: 0.8, Medium: 0.6, Low: 0.45 };
// particle kinds (u_kind) and counts at full severity
const P = {
  flake: 0, drift: 2, water: 3, spray: 4, lake: 5, smog: 6,
  dust: 10, devil: 11, quakeDust: 12,
};
const COUNTS = {
  snow: { [P.drift]: 260, [P.flake]: 12000 },  // plus a terrain mesh (the snow cover)
  glof: { [P.lake]: 70, [P.water]: 1100, [P.spray]: 520 },
  smog: { [P.smog]: 1100 },
  heat: {},                          // a terrain mesh, not particles (see heatMesh)
  drought: { [P.dust]: 260, [P.devil]: 14 },   // plus a terrain mesh (cracked, parched ground)
  quake: { [P.quakeDust]: 240 },               // plus a terrain mesh (waves, shaking, rupture)
};
const SNOW_H = 1600, WIND = [0.6, 0.25];
const QUAKE_T = 16;                // seconds between ruptures (the loop)
const QUAKE_VP = 6000, QUAKE_VS = 3500;        // P and S wave speeds in the crust, m/s
const FAULT_STRIKE = 330;          // fault bearing (°): the Himalayan frontal thrusts run NNW-SSE here

const state = { cells: [] };

/* ---------------------------------------------------------------- shaders */
const VS = `
precision highp float;
attribute vec3 a_base;               // ground spot (local m, z = ground height) — path movers: (lateral, 0, 0)
attribute vec4 a_seed;
attribute vec2 a_corner;             // -1..1
uniform mat4 u_matrix;
uniform float u_mpm, u_time, u_focal, u_kind, u_minpx, u_width, u_T;
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
    alpha = smoothstep(0.0, 0.08, f) * smoothstep(1.0, 0.94, f) * 0.9;
  } else if (isKind(${P.drift}.0)) {                    // blowing snow skimming the ground
    float f = fract(s1 + u_time * 0.07);
    p += vec3(u_wind * f * 700.0, 15.0 + 25.0 * s2);
    size = 70.0 + 110.0 * s4;
    alpha = sin(3.14159 * f) * 0.28;
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
  } else if (isKind(${P.dust}.0)) {                     // drought: sheets of dust blown low across the land
    float f = fract(s1 + u_time / (70.0 + 60.0 * s2));
    p += vec3(u_wind * (f - 0.5) * 5000.0, 20.0 + 140.0 * s2);
    size = 400.0 + 700.0 * s4;
    alpha = sin(3.14159 * f) * 0.3;
  } else if (isKind(${P.devil}.0)) {                    // drought: a dust devil whirling up, wandering downwind
    float f = fract(s1 + u_time / (24.0 + 16.0 * s2));
    size = 60.0 + 70.0 * s4; aspect = 5.0;
    p += vec3(u_wind * f * 1800.0 + vec2(cos(u_time * 0.7 + s3 * 9.0), sin(u_time * 0.9 + s3 * 9.0)) * 60.0, size * aspect);
    alpha = sin(3.14159 * f) * 0.6;
    vec3 vd = normalize(p - u_eye);
    alpha *= smoothstep(0.85, 0.5, abs(vd.z));          // a column: only reads when looking across the land
  } else if (isKind(${P.quakeDust}.0)) {                // quake: dust thrown up as the S waves pass
    float e = mod(u_time, u_T) - length(a_base.xy) / ${QUAKE_VS.toFixed(1)} - s2 * 0.6;
    p.z += 30.0 + 420.0 * (1.0 - exp(-max(e, 0.0) * 0.35));
    size = (150.0 + 300.0 * s4) * (1.0 + 0.25 * max(e, 0.0));
    alpha = step(0.0, e) * smoothstep(0.0, 0.6, e) * exp(-max(e, 0.0) * 0.3) * 0.55;
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
    float raw = size * u_focal / dist, px = max(raw, u_minpx);
    // far-off snowflakes too small to see fade out instead of speckling the map
    if (isKind(${P.flake}.0)) alpha *= smoothstep(0.5, 2.2, raw);
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
  else if (isKind(${P.drift}.0)) { a = soft * n; col = vec3(0.93, 0.95, 0.98); }
  else if (isKind(${P.water}.0)) {
    // silty glacial meltwater, white where it churns
    a = smoothstep(1.0, 0.5, r + (n - 0.5) * 0.4);
    float foam = smoothstep(0.62, 0.85, vnoise(uv * 4.0 + vec2(u_time * 3.0, v_shade * 13.0)));
    col = mix(mix(vec3(0.47, 0.46, 0.40), vec3(0.62, 0.58, 0.48), n), vec3(0.93, 0.95, 0.95), foam);   // silty grey-brown
  }
  else if (isKind(${P.spray}.0)) { a = soft * 0.9; col = vec3(0.92, 0.95, 0.97); }
  else if (isKind(${P.lake}.0)) { a = smoothstep(1.0, 0.5, r + (n - 0.5) * 0.4); col = mix(vec3(0.18, 0.55, 0.62), vec3(0.42, 0.75, 0.78), n); }
  else if (isKind(${P.smog}.0)) { a = soft * (0.65 + 0.35 * n); col = mix(vec3(0.50, 0.47, 0.40), vec3(0.66, 0.63, 0.56), n); }   // brown-grey murk
  else if (isKind(${P.dust}.0)) { a = soft * smoothstep(0.2, 0.8, n); col = mix(vec3(0.70, 0.58, 0.42), vec3(0.84, 0.74, 0.58), n); }   // tan dust
  else if (isKind(${P.devil}.0)) {
    // a funnel of dust: narrow at the ground, spreading upwards, banded as it spins
    float w = 0.3 + 0.7 * (uv.y * 0.5 + 0.5);
    float spin = 0.6 + 0.4 * sin(uv.y * 12.0 - u_time * 7.0 + uv.x * 4.0 + v_shade * 20.0);
    a = smoothstep(1.0, 0.25, abs(uv.x) / w) * smoothstep(1.0, 0.55, abs(uv.y)) * spin * (0.6 + 0.4 * n);
    col = mix(vec3(0.62, 0.50, 0.36), vec3(0.82, 0.71, 0.55), n);
  }
  else if (isKind(${P.quakeDust}.0)) { a = soft * (0.55 + 0.45 * n); col = mix(vec3(0.56, 0.50, 0.43), vec3(0.74, 0.69, 0.61), n); }   // grey-brown dust
  a *= v_alpha * u_fade;
  gl_FragColor = vec4(col * a, a);
}`;

// heatwave: a mesh lying on the terrain. It copies what the map has drawn so far
// and redraws it seen through the hot air: wavering (heat shimmer), bleached by
// the sun, hazy with distance, tinted by how hot the ground is
const HEAT_VS = `
precision highp float;
attribute vec4 a_pos;                // x, y (m east/north of the site), z (m above it, exaggerated), value 0..1
attribute vec2 a_aux;                // per effect (snow: the snowfall region)
uniform mat4 u_matrix;
uniform float u_mpm;
uniform vec3 u_eye;
varying vec3 v_w;
varying float v_heat;
varying vec2 v_aux;
void main() {
  vec3 p = a_pos.xyz;
  v_w = p;
  v_heat = a_pos.w;
  v_aux = a_aux;
  p.z += 2.0 + max(length(p - u_eye), 1.0) * 0.003;   // coarse far terrain must not swallow it
  gl_Position = u_matrix * vec4(p.x * u_mpm, -p.y * u_mpm, p.z * u_mpm, 1.0);
}`;
const HEAT_FS = `
precision highp float;
uniform sampler2D u_scene;           // the map as drawn so far (when it can be copied)
uniform float u_hasScene, u_time, u_fade, u_dpr, u_tilt, u_close;
uniform vec4 u_vp;                   // viewport: x, y, w, h (device px)
uniform vec3 u_eye;
varying vec3 v_w;
varying float v_heat;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 overlay(vec3 b, vec3 c) { return mix(2.0 * b * c, 1.0 - 2.0 * (1.0 - b) * (1.0 - c), step(0.5, b)); }
// land-surface-temperature colours: warm yellow, orange, red, deep red at the hottest
vec4 thermal(float h) {
  vec3 c = mix(vec3(1.0, 0.86, 0.36), vec3(1.0, 0.55, 0.12), smoothstep(0.12, 0.42, h));
  c = mix(c, vec3(0.90, 0.20, 0.07), smoothstep(0.42, 0.74, h));
  c = mix(c, vec3(0.56, 0.04, 0.09), smoothstep(0.76, 1.0, h));
  return vec4(c, smoothstep(0.03, 0.3, h) * 0.26 + smoothstep(0.3, 1.0, h) * 0.24);
}
void main() {
  float mask = smoothstep(0.0, 0.14, v_heat) * u_fade;
  if (mask < 0.003) discard;
  vec2 km = v_w.xy / 1000.0;
  // the heat breathes: hot spots drift and swell slowly over the ground
  float drift = fbm(km * 0.3 + vec2(u_time * 0.012, -u_time * 0.009));
  float h = clamp(v_heat * (0.8 + 0.4 * drift) * (0.95 + 0.05 * sin(u_time * 0.5)), 0.0, 1.0);
  vec3 view = v_w - u_eye;
  float dist = length(view);
  float graze = 1.0 - abs(view.z) / dist;            // 0 looking straight down, 1 looking along the ground
  // heat shimmer: the view through the hot air wavers, most when looking low across it
  vec2 uv = (gl_FragCoord.xy - u_vp.xy) / u_vp.zw;
  float fy = gl_FragCoord.y / u_dpr;
  float n = vnoise(km * 5.0 + vec2(0.0, -u_time * 0.8));
  float amp = (0.5 + 5.5 * graze * graze * graze) * smoothstep(0.08, 0.55, h) * u_dpr;
  vec2 off = vec2(sin(fy * 0.31 - u_time * 6.5 + n * 6.0), 0.55 * sin(fy * 0.19 - u_time * 4.1 + n * 4.0 + 1.3)) * amp / u_vp.zw;
  vec3 scene = texture2D(u_scene, clamp(uv + off, vec2(0.001), vec2(0.999))).rgb;
  // sun-baked light: the land looks bleached and warm
  vec3 baked = mix(scene, scene * vec3(1.10, 0.96, 0.80) + vec3(0.07, 0.04, 0.0), 0.8 * smoothstep(0.05, 0.6, h));
  // hot dusty haze thickening into the distance
  float haze = smoothstep(2500.0, 40000.0, dist) * (0.3 + 0.7 * graze) * smoothstep(0.05, 0.5, h) * 0.5;
  vec3 hazeCol = vec3(0.95, 0.87, 0.72);
  vec4 th = thermal(h);
  // a heat map from afar; close up or looking across the land, the real view
  // (sun-baked, hazy, shimmering) shows through with just a warm tint
  th.a *= mix(1.0, 0.6, u_tilt) * mix(1.0, 0.3, u_close);
  if (u_hasScene > 0.5) {
    // the heat colours tint the land itself, so fields, roads and the city still show through
    vec3 base = mix(baked, hazeCol, haze);
    vec3 col = mix(base, overlay(base, th.rgb), clamp(th.a * 2.2, 0.0, 1.0));
    col = mix(col, th.rgb, th.a * 0.45);
    gl_FragColor = vec4(col * mask, mask);
  } else {                                           // no copy of the map: just haze and heat colours over it
    float a = 1.0 - (1.0 - th.a) * (1.0 - haze);
    gl_FragColor = vec4(th.rgb * th.a + hazeCol * haze * (1.0 - th.a), a) * mask;
  }
}`;

const GROUND_NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 overlay(vec3 b, vec3 c) { return mix(2.0 * b * c, 1.0 - 2.0 * (1.0 - b) * (1.0 - c), step(0.5, b)); }`;

// drought: v_heat carries how dry the ground is (0..1)
const DROUGHT_FS = `
precision highp float;
uniform sampler2D u_scene;
uniform float u_hasScene, u_time, u_fade, u_dpr, u_tilt, u_close, u_pxAng;
uniform vec4 u_vp;
uniform vec3 u_eye;
uniform vec2 u_wind;
varying vec3 v_w;
varying float v_heat;
${GROUND_NOISE}
// a dried mud bed: the gaps between irregular clay plates (cellular noise, F2 - F1)
float plates(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    float d = length(g + hash22(i + g) * 0.85 + 0.075 - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return d2 - d1;                                    // 0 on a crack, growing into the plate
}
// one scale of cracks: cell size S metres, drawn only while the cells are big enough on screen
float crackLayer(vec2 w, float S, float mpx, float seed) {
  float px = S / mpx;                                // cell size on screen
  float vis = smoothstep(7.0, 16.0, px) * (1.0 - 0.75 * smoothstep(220.0, 700.0, px));
  if (vis <= 0.0) return 0.0;
  float width = max(1.3 * mpx, S * 0.012) / S;
  return (1.0 - smoothstep(0.0, width, plates(w / S + seed))) * vis;
}
// drought-monitor colours: abnormally dry yellow to exceptional deep brown
vec3 droughtCol(float d) {
  vec3 c = mix(vec3(0.99, 0.88, 0.50), vec3(0.93, 0.62, 0.22), smoothstep(0.15, 0.5, d));
  return mix(c, vec3(0.48, 0.24, 0.10), smoothstep(0.5, 1.0, d));
}
void main() {
  float mask = smoothstep(0.0, 0.14, v_heat) * u_fade;
  if (mask < 0.003) discard;
  vec2 km = v_w.xy / 1000.0;
  float dry = clamp(v_heat * (0.85 + 0.3 * fbm(km * 0.25 + 3.0)), 0.0, 1.0);
  vec3 view = v_w - u_eye;
  float dist = length(view);
  float graze = 1.0 - abs(view.z) / dist;
  float mpx = dist * u_pxAng;                        // metres per device pixel here
  // the cracks: big polygons (dried reservoir beds), field-sized, and the fine mud crazing up close
  float patchy = smoothstep(0.35, 0.75, dry * (0.7 + 0.6 * fbm(km * 0.6 + 7.0)));
  float lines = max(max(crackLayer(v_w.xy, 900.0, mpx, 0.0), crackLayer(v_w.xy, 180.0, mpx, 17.0) * 0.85),
                    crackLayer(v_w.xy, 36.0, mpx, 41.0) * 0.7) * patchy;
  // blowing dust and a dusty haze into the distance
  float blow = smoothstep(0.5, 0.9, fbm(km * 0.7 - u_wind * u_time * 0.05)) * dry * (0.12 + 0.3 * graze);
  float haze = smoothstep(2500.0, 40000.0, dist) * (0.3 + 0.7 * graze) * smoothstep(0.1, 0.6, dry) * 0.5;
  vec3 dustCol = vec3(0.80, 0.69, 0.52);
  float tintA = (0.12 + 0.2 * smoothstep(0.2, 1.0, dry)) * mix(1.0, 0.5, u_tilt) * mix(1.0, 0.25, u_close);
  if (u_hasScene > 0.5) {
    vec3 scene = texture2D(u_scene, (gl_FragCoord.xy - u_vp.xy) / u_vp.zw).rgb;
    // parched: the green drains out of the fields, the land turns tan and brown
    float l = dot(scene, vec3(0.30, 0.59, 0.11));
    vec3 parched = vec3(l * 1.08 + 0.07, l * 0.93 + 0.045, l * 0.70 + 0.01);
    vec3 col = mix(scene, parched, 0.85 * smoothstep(0.05, 0.7, dry));
    col = mix(col, overlay(col, droughtCol(dry)), clamp(tintA * 2.0, 0.0, 1.0));
    col = mix(col, col * 0.28, lines * 0.9);         // dark, shadowed cracks
    col = mix(col, dustCol, max(blow, haze));
    gl_FragColor = vec4(col * mask, mask);
  } else {
    vec4 c = vec4(droughtCol(dry), tintA);
    c = mix(c, vec4(0.18, 0.12, 0.08, 0.8), lines * 0.9);
    c = mix(c, vec4(dustCol, 0.6), max(blow, haze));
    gl_FragColor = vec4(c.rgb * c.a, c.a) * mask;
  }
}`;

// earthquake: v_heat is just the edge of the shaking zone; everything else follows
// from the distance to the epicentre and the time since the rupture
const QUAKE_FS = `
precision highp float;
uniform sampler2D u_scene;
uniform float u_hasScene, u_time, u_fade, u_dpr, u_tilt, u_close, u_pxAng, u_R, u_T, u_len;
uniform vec4 u_vp;
uniform vec3 u_eye;
uniform vec2 u_strike;               // fault direction (x east, y north)
varying vec3 v_w;
varying float v_heat;
${GROUND_NOISE}
// ShakeMap intensity colours: light felt shaking blue-green, to yellow, orange, red, violent dark red
vec3 shakeCol(float i) {
  vec3 c = mix(vec3(0.55, 0.85, 0.95), vec3(0.55, 0.95, 0.55), smoothstep(0.0, 0.25, i));
  c = mix(c, vec3(1.0, 0.92, 0.25), smoothstep(0.25, 0.5, i));
  c = mix(c, vec3(1.0, 0.55, 0.10), smoothstep(0.5, 0.7, i));
  c = mix(c, vec3(0.88, 0.12, 0.06), smoothstep(0.7, 0.88, i));
  return mix(c, vec3(0.55, 0.03, 0.05), smoothstep(0.88, 1.0, i));
}
void main() {
  float mask = smoothstep(0.0, 0.14, v_heat) * u_fade;
  if (mask < 0.003) discard;
  vec2 xy = v_w.xy;
  float d = length(xy);
  vec3 view = v_w - u_eye;
  float dist = length(view);
  float mpx = dist * u_pxAng;
  float ph = mod(u_time, u_T);                       // seconds since the rupture
  // how hard the ground shakes, falling off with distance (geometric spreading)
  float atten = 1.0 / (1.0 + d / (0.12 * u_R));
  float intensity = clamp(1.0 - log(1.0 + d / (0.04 * u_R)) / log(1.0 + 1.0 / 0.04), 0.0, 1.0);
  float tP = ph - d / ${QUAKE_VP.toFixed(1)}, tS = ph - d / ${QUAKE_VS.toFixed(1)};
  float shakeP = step(0.0, tP) * exp(-tP * 1.4) * 0.35;
  float shakeS = step(0.0, tS) * exp(-tS * 0.5);
  float shake = (shakeP + shakeS) * atten;
  // the wave fronts: thin bright rings, with the ground rolling in ripples behind the S front
  float w = max(0.012 * u_R, 4.0 * mpx);
  float frontP = exp(-pow((ph * ${QUAKE_VP.toFixed(1)} - d) / w, 2.0)) * 0.45;
  float frontS = exp(-pow((ph * ${QUAKE_VS.toFixed(1)} - d) / (w * 1.4), 2.0));
  float fade = 1.0 - smoothstep(0.6, 1.0, ph / u_T);  // the last waves die out before the next rupture
  float rings = (frontP + frontS) * sqrt(atten) * fade;
  float roll = sin((d - ph * ${QUAKE_VS.toFixed(1)}) / (0.05 * u_R) * 6.2832) * shakeS * atten;
  // the surface rupture: a jagged tear along the fault, opening outwards from the epicentre at ~2.8 km/s
  vec2 across = vec2(u_strike.y, -u_strike.x);
  float along = dot(xy, u_strike);
  float off = dot(xy, across) - (fbm(vec2(along / 4000.0, 3.0)) - 0.5) * 0.03 * u_R;
  float reach = min(u_len, ph * 2800.0 + 2000.0);
  float tear = (1.0 - smoothstep(0.0, max(0.002 * u_R, 1.8 * mpx), abs(off))) * (1.0 - smoothstep(reach * 0.85, reach, abs(along)));
  tear *= 0.6 + 0.4 * smoothstep(0.3, 0.7, fbm(vec2(along / 900.0, 9.0)));
  // the epicentre flashes at the rupture
  float core = exp(-d / (0.025 * u_R)) * (0.35 + 0.65 * exp(-ph * 0.8));
  vec3 ringCol = vec3(1.0, 0.62, 0.18);
  float mapA = (0.16 + 0.22 * shake) * mix(1.0, 0.55, u_tilt) * mix(1.0, 0.4, u_close);
  if (u_hasScene > 0.5) {
    // the land itself shakes (jolted every which way) and rolls as the waves pass
    vec2 jolt = vec2(sin(u_time * 37.0 + d * 0.0021), cos(u_time * 29.0 + d * 0.0017)) * shake * 6.0;
    vec2 offPx = (jolt + vec2(0.0, roll * 5.0)) * u_dpr;
    vec3 col = texture2D(u_scene, clamp((gl_FragCoord.xy - u_vp.xy + offPx) / u_vp.zw, vec2(0.001), vec2(0.999))).rgb;
    col = mix(col, overlay(col, shakeCol(intensity)), clamp(mapA * 2.0, 0.0, 1.0));
    col += ringCol * rings * 0.55 + vec3(1.0, 0.35, 0.15) * core * 0.6;
    col = mix(col, vec3(0.10, 0.07, 0.05) + vec3(0.5, 0.12, 0.04) * shake, tear * 0.92);
    gl_FragColor = vec4(col * mask, mask);
  } else {
    float a = clamp(mapA + rings * 0.5 + core * 0.5, 0.0, 1.0);
    vec3 col = (shakeCol(intensity) * mapA + ringCol * rings * 0.5 + vec3(1.0, 0.35, 0.15) * core * 0.5) / max(a, 1e-3);
    vec4 c = mix(vec4(col, a), vec4(0.10, 0.07, 0.05, 0.9), tear * 0.92);
    gl_FragColor = vec4(c.rgb * c.a, c.a) * mask;
  }
}`;

// snow: v_heat is how deep the snow lies (0..1), v_aux.x the snowfall region
const SNOW_FS = `
precision highp float;
uniform sampler2D u_scene;
uniform float u_hasScene, u_time, u_fade, u_tilt, u_close;
uniform vec4 u_vp;
uniform vec3 u_eye;
varying vec3 v_w;
varying float v_heat;
varying vec2 v_aux;
${GROUND_NOISE}
void main() {
  float mask = smoothstep(0.0, 0.12, v_aux.x) * u_fade;
  if (mask < 0.003) discard;
  vec2 km = v_w.xy / 1000.0;
  vec3 view = v_w - u_eye;
  float dist = length(view);
  float graze = 1.0 - abs(view.z) / dist;
  // patchy where it lies thin, unbroken where it is deep
  float cover = smoothstep(0.12, 0.55, v_heat + (fbm(km * 6.0) - 0.5) * 0.35 + (fbm(km * 40.0) - 0.5) * 0.12);
  // the haze of falling snow: the distance greys out
  float haze = smoothstep(800.0, 16000.0, dist) * (0.3 + 0.7 * graze) * 0.5 * smoothstep(0.1, 0.5, v_aux.x);
  vec3 hazeCol = vec3(0.84, 0.87, 0.92);
  if (u_hasScene > 0.5) {
    vec3 scene = texture2D(u_scene, (gl_FragCoord.xy - u_vp.xy) / u_vp.zw).rgb;
    float l = dot(scene, vec3(0.30, 0.59, 0.11));
    // the land's own light and shade show on the snow: blue in shadow, bright where the sun falls
    vec3 snow = mix(vec3(0.62, 0.69, 0.82), vec3(0.97, 0.98, 1.0), smoothstep(0.06, 0.45, l));
    // dark forest keeps showing through, dusted white
    float trees = (1.0 - smoothstep(0.08, 0.22, l)) * smoothstep(-0.02, 0.05, scene.g - scene.r);
    vec3 col = mix(scene, snow, cover * (1.0 - 0.5 * trees));
    col = mix(col, hazeCol, haze);
    gl_FragColor = vec4(col * mask, mask);
  } else {
    float a = max(cover * 0.85, haze);
    gl_FragColor = vec4(mix(vec3(0.95, 0.97, 1.0), hazeCol, haze) * a, a) * mask;
  }
}`;

/* ---------------------------------------------------------------- GL */
let gl = null, prog = null, groundFx = null;
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
  // the ground effects share the terrain-mesh vertex shader
  const groundProgram = (fs) => {
    const gp = gl.createProgram();
    gl.attachShader(gp, compile(HEAT_VS, gl.VERTEX_SHADER)); gl.attachShader(gp, compile(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(gp);
    if (!gl.getProgramParameter(gp, gl.LINK_STATUS)) throw new Error('[hazards3d] ' + gl.getProgramInfoLog(gp));
    const gu = {}, gn = gl.getProgramParameter(gp, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < gn; i++) { const name = gl.getActiveUniform(gp, i).name; gu[name] = gl.getUniformLocation(gp, name); }
    return { p: gp, u: gu, a: gl.getAttribLocation(gp, 'a_pos'), aux: gl.getAttribLocation(gp, 'a_aux') };
  };
  groundFx = {
    heat: groundProgram(HEAT_FS), drought: groundProgram(DROUGHT_FS), quake: groundProgram(QUAKE_FS), snow: groundProgram(SNOW_FS),
  };
  Object.assign(scene, { tex: null, fb: null, mode: 'copy', checks: 0 });
  state.cells.forEach((c) => { c.buffers = null; c.mesh = null; });
}
function onRemove() {
  gl = null; prog = null; groundFx = null;
  Object.assign(scene, { tex: null, fb: null });
  state.cells.forEach((c) => { c.buffers = null; c.mesh = null; });
}

/* ---------------------------------------------------------------- copy of the map for the heat shimmer */
// copied straight from the framebuffer; where that isn't allowed (multisampled
// buffers) a WebGL2 blit resolves it into our own texture; failing both, the
// heatwave is drawn without the shimmer
const scene = { tex: null, fb: null, w: 0, h: 0, mode: 'copy', checks: 0 };
function captureScene(vp) {
  if (scene.mode === 'off') return false;
  const [x, y, w, h] = vp;
  if (!scene.tex) {
    scene.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    scene.w = 0;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, scene.tex);
  if (scene.w !== w || scene.h !== h) {
    const fmt = scene.mode === 'blit' || (gl.getContextAttributes() || {}).alpha !== false ? gl.RGBA : gl.RGB;
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt, gl.UNSIGNED_BYTE, null);
    scene.w = w; scene.h = h; scene.checks = 0;
  }
  const check = scene.checks < 3;                    // the first few copies are checked, then trusted
  if (check) { scene.checks++; while (gl.getError() !== gl.NO_ERROR) { /* clear older errors */ } }
  if (scene.mode === 'copy') {
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, x, y, w, h);
  } else {
    const drawFb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    if (!scene.fb) scene.fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.fb);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scene.tex, 0);
    gl.blitFramebuffer(x, y, x + w, y + h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFb);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
  }
  if (check && gl.getError() !== gl.NO_ERROR) {
    const next = scene.mode === 'copy' && typeof gl.blitFramebuffer === 'function' ? 'blit' : 'off';
    console.warn(`[hazards3d] heat shimmer: framebuffer ${scene.mode} failed, ${next === 'off' ? 'drawing without it' : 'trying a blit'}`);
    scene.mode = next; scene.w = 0;
    return false;
  }
  return true;
}

/* ---------------------------------------------------------------- building a site */
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
function elevation(lngLat) {
  const e = map.queryTerrainElevation && map.queryTerrainElevation(lngLat, { exaggerated: true });
  return e == null ? null : e;
}
/* real population density (people per km², WorldPop 1 km grid) for the urban heat island */
let popGrid = null;
function popDensity(lng, lat) {
  if (!popGrid) return 0;
  for (const g of popGrid) {
    const fx = (lng - g.west) / g.dx - 0.5, fy = (g.north - lat) / g.dy - 0.5;
    if (fx < 0 || fy < 0 || fx > g.w - 1 || fy > g.h - 1) continue;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const d = (a, b) => g.density[Math.min(g.h - 1, b) * g.w + Math.min(g.w - 1, a)] || 0;
    return (d(i, j) * (1 - tx) + d(i + 1, j) * tx) * (1 - ty) + (d(i, j + 1) * (1 - tx) + d(i + 1, j + 1) * tx) * ty;
  }
  return 0;
}
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise2(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm2 = (x, y) => noise2(x, y) * 0.55 + noise2(x * 2.1, y * 2.1) * 0.3 + noise2(x * 4.3, y * 4.3) * 0.15;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/* heatwave: a mesh on the terrain carrying how hot the ground gets. A heatwave
   is regional: a broad, uneven hot patch spreads three times the site radius
   around it, and inside it the city bakes hottest where it is densest (real
   population: the urban heat island). The heat falls off up the hills (the air
   cools about 6.5 °C per km of height) and stays low over the sea */
const HEAT_N = 150, REGION = 3;
/* a grid lying on the terrain over a square of half-size `half`, carrying
   value(x, y, r, er, r0) at each point (r: distance / R, er: real height here,
   r0: real height at the site): a number, or { v, a, b } where a/b go to the
   shader as v_aux. adjust(grid, step) may rework the values first; cells with
   nothing in them are dropped (auxKeeps: unless their a is set) */
function terrainMesh(cell, R, half, at, value, { adjust, auxKeeps = false } = {}) {
  const mx = 111320 * Math.cos((cell.lngLat[1] * Math.PI) / 180), my = 110540;
  const real = (x, y) => map.queryTerrainElevation([cell.lngLat[0] + x / mx, cell.lngLat[1] + y / my], { exaggerated: false });
  const e0 = at(0, 0), r0 = real(0, 0) ?? 0, step = (2 * half) / HEAT_N;
  // the map's height exaggeration, so each point needs one terrain lookup, not two
  const ratio = e0 != null && r0 > 5 ? e0 / r0 : null;
  const grid = [];
  let missing = false;
  for (let j = 0; j <= HEAT_N; j++) {
    for (let i = 0; i <= HEAT_N; i++) {
      const x = -half + i * step, y = -half + j * step;
      const er = real(x, y), e = ratio ? (er == null ? null : er * ratio) : at(x, y);
      if (e == null || er == null) missing = true;
      let out = value(x, y, Math.hypot(x, y) / R, er, r0);
      if (typeof out === 'number') out = { v: out };
      grid.push([x, y, (e ?? e0) - e0, Math.max(0, out.v), out.a || 0, out.b || 0, er ?? r0]);
    }
  }
  if (adjust) adjust(grid, step);
  // the grid is coarser than the terrain: lift each point to the highest ground
  // around it so steep ridges between the points can't poke through (the effects
  // redraw what is under them on screen, so riding a little high over a valley is harmless)
  const top = grid.map((g, idx) => {
    const i = idx % (HEAT_N + 1), j = (idx - i) / (HEAT_N + 1);
    let z = g[2];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const n = grid[(j + dj) * (HEAT_N + 1) + i + di];
      if (n && i + di >= 0 && i + di <= HEAT_N) z = Math.max(z, n[2]);
    }
    return z;
  });
  grid.forEach((g, idx) => { g[2] = top[idx]; });
  const tris = [];
  for (let j = 0; j < HEAT_N; j++) {
    for (let i = 0; i < HEAT_N; i++) {
      const a = grid[j * (HEAT_N + 1) + i], b = grid[j * (HEAT_N + 1) + i + 1];
      const c = grid[(j + 1) * (HEAT_N + 1) + i], d = grid[(j + 1) * (HEAT_N + 1) + i + 1];
      if (Math.max(a[3], b[3], c[3], d[3]) < 0.005 && !(auxKeeps && Math.max(a[4], b[4], c[4], d[4]) >= 0.005)) continue;
      tris.push(a, b, d, a, d, c);
    }
  }
  const verts = new Float32Array(tris.length * 6);
  tris.forEach((g, k) => verts.set(g.slice(0, 6), k * 6));
  return { verts, missing };
}
function heatMesh(cell, R, k, at) {
  const mx = 111320 * Math.cos((cell.lngLat[1] * Math.PI) / 180), my = 110540, seed = cell.phase;
  return terrainMesh(cell, R, R * REGION * 1.05, at, (x, y, r, er, r0) => {
    const region = 1 - smooth(0.3, 1.0, r / REGION + (fbm2(x / R * 0.8 + seed, y / R * 0.8) - 0.5) * 0.45);
    const city = 1 - smooth(0.1, 1.0, r + (fbm2(x / R * 2.4 + seed + 7, y / R * 2.4) - 0.5) * 0.5);
    if (region <= 0 && city <= 0) return 0;
    const d = popDensity(cell.lngLat[0] + x / mx, cell.lngLat[1] + y / my);
    const urban = Math.min(1, Math.log10(1 + d) / Math.log10(1 + 15000));
    let h = Math.min(1, region * 0.34 + city * (0.25 + 0.5 * urban));
    h *= Math.min(1, Math.max(0.3, 1 - Math.max(0, (er ?? r0) - r0) / 1500));
    if (er != null && er <= 0.5) h *= 0.25;
    return h * (0.55 + 0.45 * k);
  });
}
/* drought: an uneven parched region, driest at its heart; the sea isn't dry land */
function droughtMesh(cell, R, k, at) {
  const seed = cell.phase;
  return terrainMesh(cell, R, R * 1.1, at, (x, y, r, er) => {
    const h = 1 - smooth(0.25, 1.0, r + (fbm2(x / R * 1.6 + seed, y / R * 1.6) - 0.5) * 0.55);
    return er != null && er <= 0.5 ? 0 : h * (0.6 + 0.4 * k);
  });
}
/* earthquake: the strong-shaking zone (the shader works out the waves from the distance) */
function quakeMesh(cell, R, k, at) {
  return terrainMesh(cell, R, R * 1.05, at, (x, y, r) => 1 - smooth(0.85, 1.02, r));
}
/* snow: where the snowfall is (v_aux.x) and how deep it lies: deeper the higher
   the ground (the valleys below the site get little), and it slides off slopes
   steeper than about 40° */
function snowMesh(cell, R, k, at) {
  const seed = cell.phase;
  return terrainMesh(cell, R, R * 1.1, at, (x, y, r, er, r0) => {
    const region = 1 - smooth(0.6, 1.05, r + (fbm2(x / R * 1.4 + seed, y / R * 1.4) - 0.5) * 0.4);
    const high = smooth(r0 - 550, r0 + 250, er ?? r0);
    return { v: region * (0.2 + 0.8 * high) * (0.75 + 0.25 * k), a: region };
  }, { adjust(grid, step) {
    const n = HEAT_N + 1;
    for (let j = 1; j < HEAT_N; j++) {
      for (let i = 1; i < HEAT_N; i++) {
        const sx = (grid[j * n + i + 1][6] - grid[j * n + i - 1][6]) / (2 * step);
        const sy = (grid[(j + 1) * n + i][6] - grid[(j - 1) * n + i][6]) / (2 * step);
        const slope = (Math.atan(Math.hypot(sx, sy)) * 180) / Math.PI;
        grid[j * n + i][3] *= 1 - 0.85 * smooth(30, 50, slope);
      }
    }
  }, auxKeeps: true });
}
const GROUND_MESH = { heat: heatMesh, drought: droughtMesh, quake: quakeMesh, snow: snowMesh };
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
  const disc = (radius) => () => {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    return [x, y, ground(x, y)];
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
  }
  if (cell.kind === 'drought') {
    data[P.dust] = make(n(P.dust), disc(R * 0.9));
    data[P.devil] = make(n(P.devil), disc(R * 0.6));
  }
  if (cell.kind === 'quake') {
    // dust is thrown up round the epicentre and along the fault
    const s = (FAULT_STRIKE * Math.PI) / 180, dir = [Math.sin(s), Math.cos(s)], len = R * 0.45;
    cell.strike = dir; cell.len = len;
    data[P.quakeDust] = make(n(P.quakeDust), () => {
      if (Math.random() < 0.35) return disc(R * 0.25)();
      const a = (Math.random() * 2 - 1) * len, j = (Math.random() - 0.5) * R * 0.06;
      const x = dir[0] * a + dir[1] * j, y = dir[1] * a - dir[0] * j;
      return [x, y, ground(x, y)];
    });
  }
  if (GROUND_MESH[cell.kind]) {
    const m = GROUND_MESH[cell.kind](cell, R, k, at);
    if (m.missing) missing = true;
    if (cell.mesh) gl.deleteBuffer(cell.mesh.b);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, m.verts, gl.STATIC_DRAW);
    cell.mesh = { b, n: m.verts.length / 6 };
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
const MINPX = { [P.flake]: 1, [P.drift]: 2, [P.spray]: 1.2, [P.smog]: 4 };
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
    const R = (KIND[cell.kind].R[cell.severity] || KIND[cell.kind].R.Medium) * (cell.kind === 'heat' ? REGION : 1);
    const px = map.project(cell.lngLat), reach = R / mpp(cell.lngLat[1]) * 1.2;
    return px.x > -reach && px.x < w + reach && px.y > -reach && px.y < h + reach;
  });
  if (!live.length) return;
  const pos = map.getFreeCameraOptions().position;
  const half = [gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2];
  const focal = half[1] / Math.tan(((map.transform && map.transform.fov) || 36.87) * Math.PI / 360);

  gl.useProgram(prog.p);
  gl.enableVertexAttribArray(prog.a.base); gl.enableVertexAttribArray(prog.a.seed); gl.enableVertexAttribArray(prog.a.corner);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
    gl.uniform1f(prog.u.u_T, QUAKE_T);
    if (cell.path) { gl.uniform3fv(prog.u.u_path, cell.path); gl.uniform1f(prog.u.u_width, cell.width); }
    for (const buf of cell.buffers) {
      gl.uniform1f(prog.u.u_kind, buf.kind);
      gl.uniform1f(prog.u.u_minpx, MINPX[buf.kind] || 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.b);
      gl.vertexAttribPointer(prog.a.base, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribPointer(prog.a.seed, 4, gl.FLOAT, false, 36, 12);
      gl.vertexAttribPointer(prog.a.corner, 2, gl.FLOAT, false, 36, 28);
      gl.drawArrays(gl.TRIANGLES, 0, buf.n);
    }
  }
  gl.disableVertexAttribArray(prog.a.base); gl.disableVertexAttribArray(prog.a.seed); gl.disableVertexAttribArray(prog.a.corner);
  drawGround(matrix, live.filter((c) => c.mesh), now, zoom, pos, focal);
  gl.depthMask(true);
  map.triggerRepaint();
}
// the effects drawn on the ground: heatwave, drought, earthquake. Each redraws the
// map under it from one copy of the frame (shimmering, parched, shaking)
function drawGround(matrix, cells, now, zoom, pos, focal) {
  if (!cells.length || !groundFx) return;
  const vp = gl.getParameter(gl.VIEWPORT);
  const hasScene = captureScene(vp);
  const dpr = gl.drawingBufferWidth / Math.max(1, map.getCanvas().clientWidth);
  const tilt = Math.min(1, Math.max(0, (map.getPitch() - 30) / 45)), close = Math.min(1, Math.max(0, (zoom - 10.5) / 3));
  for (const cell of cells) {
    const g = groundFx[cell.kind];
    if (!g) continue;
    const set = (name, ...v) => { const loc = g.u[name]; if (loc) gl[`uniform${v.length}f`](loc, ...v); };
    gl.useProgram(g.p);
    if (g.u.u_scene) gl.uniform1i(g.u.u_scene, 0);
    set('u_hasScene', hasScene ? 1 : 0);
    set('u_vp', vp[0], vp[1], vp[2], vp[3]);
    set('u_dpr', dpr); set('u_tilt', tilt); set('u_close', close); set('u_pxAng', 1 / focal);
    set('u_wind', WIND[0], WIND[1]); set('u_T', QUAKE_T);
    const merc = window.mapboxgl.MercatorCoordinate.fromLngLat(cell.lngLat, cell.elev);
    const mpm = merc.meterInMercatorCoordinateUnits();
    gl.uniformMatrix4fv(g.u.u_matrix, false, translated(matrix, merc));
    set('u_mpm', mpm);
    set('u_eye', (pos.x - merc.x) / mpm, (merc.y - pos.y) / mpm, (pos.z - merc.z) / mpm);
    set('u_time', now / 1000 + cell.phase);
    set('u_fade', Math.min(1, zoom - KIND[cell.kind].minZoom));
    set('u_R', cell.R);
    if (cell.strike) { set('u_strike', cell.strike[0], cell.strike[1]); set('u_len', cell.len); }
    gl.bindBuffer(gl.ARRAY_BUFFER, cell.mesh.b);
    gl.enableVertexAttribArray(g.a);
    gl.vertexAttribPointer(g.a, 4, gl.FLOAT, false, 24, 0);
    if (g.aux >= 0) { gl.enableVertexAttribArray(g.aux); gl.vertexAttribPointer(g.aux, 2, gl.FLOAT, false, 24, 16); }
    gl.drawArrays(gl.TRIANGLES, 0, cell.mesh.n);
    gl.disableVertexAttribArray(g.a);
    if (g.aux >= 0) gl.disableVertexAttribArray(g.aux);
  }
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
  fetch('./public/pop_grid.json').then((r) => r.json()).then((j) => {
    popGrid = Object.values(j.cities || {});
    state.cells.forEach((c) => { if (c.kind === 'heat') c.rebuildAt = 0; });
    map.triggerRepaint();
  }).catch((err) => console.warn('[hazards3d] population grid unavailable:', err.message));
  ensureLayer();
})();
