/**
 * waterSurface.js — animated WebGL water-surface fill for GeoJSON polygons.
 * ---------------------------------------------------------------------------
 * Renders a colored, semi-transparent water body with directional rolling
 * waves, depth-based color gradient, a foamy bank band, caustic shimmer in the
 * shallows, refraction of the riverbed texture, sky reflection in the wave
 * facets and a moving specular sun glint — clipped exactly to each polygon's
 * true shape (holes / islands included) with a stencil mask.
 *
 * Surface fill only: no particles, no flow arrows, no foam sprites, no UI.
 *
 * Dependency: a simple-polygon triangulator with the `earcut(coords, holes,
 * dim) -> indices` signature. Pass it in as `init(gl, canvas, { earcut })`, or
 * expose it as `globalThis.earcut`. Nothing else is required.
 *
 * Usage (matches the module API):
 *   import water from './waterSurface.js';
 *   water.init(gl, canvas, { earcut });
 *   water.setPolygons(featureCollection, { bearingByFeature, avgSpeedByFeature });
 *   water.setPalette('dark');
 *   water.render(dt, map.getBearing(), speedMultiplier, (lon, lat) => map.project([lon, lat]));
 *
 * `createWaterSurface()` returns an independent instance if you need more than
 * one layer / context.
 */

/* ------------------------------------------------------------------ palettes */

export const PALETTES = {
  // deep / shallow / foam / opacity / glint as before, plus the reflection sky
  // (u_skyH horizon, u_skyZ zenith) and reflection strength (u_refl) per style.
  terrain:   { deep: [0.031, 0.176, 0.322], shallow: [0.169, 0.400, 0.596], foam: [0.92, 0.97, 1.0], op: 0.66, glint: 1.0,
               skyH: [0.78, 0.85, 0.92], skyZ: [0.33, 0.51, 0.75], refl: 1.0 },
  satellite: { deep: [0.031, 0.176, 0.322], shallow: [0.169, 0.400, 0.596], foam: [0.92, 0.97, 1.0], op: 0.66, glint: 1.0,
               skyH: [0.78, 0.85, 0.92], skyZ: [0.33, 0.51, 0.75], refl: 1.0 },
  dark:      { deep: [0.016, 0.110, 0.239], shallow: [0.086, 0.310, 0.553], foam: [0.85, 0.95, 1.0], op: 0.74, glint: 1.35,
               skyH: [0.10, 0.15, 0.24], skyZ: [0.03, 0.06, 0.12], refl: 0.8 },
  streets:   { deep: [0.039, 0.204, 0.373], shallow: [0.196, 0.443, 0.639], foam: [0.93, 0.98, 1.0], op: 0.62, glint: 1.0,
               skyH: [0.80, 0.87, 0.93], skyZ: [0.38, 0.55, 0.78], refl: 0.9 },
};

/* ------------------------------------------------------------------- shaders */

const VERT = `precision highp float;
attribute vec2 a_uv;
attribute vec2 a_pos;
uniform vec2 u_res;
// Perspective restore. The mesh is drawn as flat screen-space triangles, so
// v_uv would interpolate affinely -- correct for a top-down camera, badly
// wrong under pitch, where near-camera fragments smear the texture into long
// streaks. For a planar map, the homogeneous denominator of the screen->ground
// homography is an affine function of the screen position; feeding it back as
// gl_Position.w restores perspective-correct interpolation without moving a
// single pixel of the silhouette. u_persp = (1, 0, 0) is the plain spec path.
uniform vec3 u_persp;
varying vec2 v_uv;
varying vec2 v_scr;            // screen uv (y = 0 at top) — grazing-angle reflection
void main(){
  v_uv = a_uv;
  vec2 c = (a_pos / u_res) * 2.0 - 1.0;
  v_scr = a_pos / u_res;
  // Clamped, not signed: a vertex behind the camera reports a mirrored screen
  // position whose x*w product overflows float precision, so those triangles
  // are better left to the wild-vertex guard on the CPU (see filterMesh).
  float q = max(u_persp.x + u_persp.y * a_pos.x + u_persp.z * a_pos.y, 1e-3);
  float wq = 1.0 / q;
  gl_Position = vec4(c.x * wq, -c.y * wq, 0.0, wq);
}`;

const FRAG = `#extension GL_OES_standard_derivatives : enable
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
varying vec2 v_scr;
uniform sampler2D u_sdf;
uniform float u_time;
uniform vec2 u_flow;
uniform float u_scroll;
uniform vec3 u_deep;
uniform vec3 u_shallow;
uniform vec3 u_foam;
uniform float u_op;
uniform vec2 u_sun;
uniform float u_glint;
uniform float u_rain;

// "look" controls -- all neutral (1.0 / spec ramp / detail 1.0) reproduces the
// original shader exactly; see LOOKS below.
uniform float u_dgamma;    // depth curve: <1 pushes the interior towards deep
uniform float u_foamk;     // foam intensity
uniform float u_foamw;     // foam band width
uniform float u_caustic;   // shallow-water caustic strength
uniform float u_sparkle;   // specular sparkle strength
uniform vec2  u_ramp;      // shallow->deep colour ramp (smoothstep edges)
uniform float u_detail;    // ripple detail scale, grows with on-screen size
uniform float u_dnoise;    // organic wobble on the shore ramp (hides SDF texels)
uniform float u_wave;      // diffuse shading on wave faces
uniform float u_broad;     // broad (rough-water) specular lobe
uniform vec2  u_sdftex;    // depth-texture size, for footprint estimation
uniform float u_refract;   // refraction strength, in units of the reference 0.028 uv bend
uniform float u_reflect;   // reflection strength multiplier (from the look)
uniform vec3  u_skyH;      // sky horizon colour (reflection), per map style
uniform vec3  u_skyZ;      // sky zenith colour (reflection), per map style
uniform float u_refl;      // palette reflection strength × u_reflect
uniform float u_pitch;     // map pitch factor 0..1 — grazing views mirror more sky
uniform float u_alpha;     // user opacity multiplier (setOpacity); 1 = palette default
uniform float u_grow;      // staged-inundation clock [0..1] (setGrow); 1 = fully spread
uniform float u_growStart; // this polygon's delay on that clock (props.reveal); <0 = not staged

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  return vnoise(p) * 0.6 + vnoise(p * 2.13 + 7.7) * 0.4;
}

void main(){
  float depth = pow(texture2D(u_sdf, v_uv).r, u_dgamma);
  float t = u_time;
  vec2 fl = u_flow;
  vec2 pp = vec2(-fl.y, fl.x);
  vec2 q = v_uv * 3.0;

  // zoomed in, the polygon covers more pixels: shrink the wave/ripple scale with
  // it (and speed up phase to match) so the surface keeps a constant apparent
  // texture instead of stretching into flat gradients.
  float S = sqrt(u_detail);
  vec2 qw = q * S;
  float tw = t * S;
  vec2 qd = q * u_detail;
  float td = t * u_detail;

  // Zoom compaction. The bank band and the shallow zone are measured in
  // normalised depth, i.e. in *metres of distance to the bank*, so zooming in
  // blows them up until pale shallow water and foam cover the whole screen.
  // Shrink them as the polygon grows on screen so they stay a plausible strip
  // of surf at the water's edge. u_detail == 1 (low zoom, and the 'spec' look)
  // leaves every term exactly as it was.
  float zc = 1.0 / max(1.0, pow(u_detail, 0.6));
  float zcSoft = mix(1.0, zc, 0.85);

  // Distance fade. Under pitch, a pixel far up the screen covers a lot of
  // river, so the fine procedural terms (sparkle, caustics, the foam band)
  // alias into a bright haze -- the pale wash across the far half of a tilted
  // view. Measure the uv footprint of this pixel and fade detail out as it
  // stops being resolvable, the way a mip chain would.
#ifdef GL_OES_standard_derivatives
  vec2 fwuv = fwidth(v_uv);
  float foot = max(fwuv.x, fwuv.y) * 3.0 * u_detail;   // q units per pixel
  vec2 tpp = fwuv * u_sdftex;                          // depth texels per pixel
  float mip = max(tpp.x, tpp.y);
#else
  float foot = 0.0;
  float mip = 0.0;
#endif
  float fadeFine = clamp(1.0 - foot * 28.0, 0.0, 1.0);   // sparkle-scale detail
  float fadeMid  = clamp(1.0 - foot * 7.0, 0.0, 1.0);    // ripple/foam scale

  // Once a pixel covers several depth texels there is no mip chain to fall
  // back on (the distance rasters are non-power-of-two), so the point sample
  // lands anywhere between bank and mid-channel -- across a pitched view that
  // reads as a flat pale sheet. Blend towards mid-channel as the footprint
  // grows: far water should look like uniform deep water, not like bank.
  // Kept as scalars so the dispersed refraction taps below get byte-identical
  // treatment.
  float farBlend = clamp((mip - 1.0) * 0.30, 0.0, 0.9);
  // breaks up the bilinear structure of the (necessarily coarse) distance
  // raster with a slow organic wobble -- also reads as water lapping the bank
  float wobble = (fbm(q * u_detail * 3.0 + fl * t * 0.5) - 0.5) * u_dnoise * zc;
  depth = clamp(mix(depth, 0.78, farBlend) + wobble, 0.0, 1.0);

  // animated wave field: directional waves along/across the current
  float w1 = sin(dot(qw, fl) * 26.0 - tw * (2.2 + u_scroll));
  float w2 = sin(dot(qw, fl) * 47.0 + dot(qw, pp) * 9.0 - tw * 3.4);
  float w3 = sin(dot(qw, pp) * 33.0 - tw * 1.7) * 0.6;
  float w4 = sin(dot(qw, fl) * 13.0 - tw * 1.2 + fbm(qw * 4.0 + tw * 0.15) * 4.0) * 0.8;
  float h = (w1 * 0.5 + w2 * 0.28 + w3 * 0.4 + w4 * 0.5) * (0.35 + 0.65 * depth);

  // surface normal: analytic wave slope + scrolling fbm detail
  float e = 0.012;
  float hx = fbm(qd * 6.0 + fl * td * u_scroll * 0.6) - fbm(qd * 6.0 + vec2(e, 0.0) + fl * td * u_scroll * 0.6);
  float hy = fbm(qd * 6.0 + vec2(0.0, td * 0.1)) - fbm(qd * 6.0 + vec2(0.0, e + td * 0.1));
  vec3 N = normalize(vec3(-h * 1.4 + hx * 2.2, -h * 1.1 + hy * 2.2, 1.0));

  // ---- refraction: the bed seen through bent, chromatically dispersed rays --
  // The local wave slope bends the view ray; re-sampling the depth field at
  // the displaced position makes the depth ramp wobble through passing waves,
  // and the 1.15 / 1.0 / 0.85 split (red bends most, blue least) fringes those
  // transitions subtly with chromatic aberration. u_refract scales the 0.028
  // reference bend; 0 keeps the spec path pixel-exact. The bend follows the
  // zoom-compacted ramp (zcSoft): the fringe is the taps straddling the ramp,
  // so it must shrink with the ramp or high zoom turns the shallows into
  // rainbow mottling. The un-refracted depth above stays authoritative for
  // foam, wave damping and alpha.
  // bend also fades with the pixel footprint (0.35 floor): tiny-on-screen
  // ponds and far pitched sheets fringe into confetti otherwise
  vec2 refr = N.xy * (0.028 * u_refract) * (0.35 + 0.65 * depth) * zcSoft * (0.35 + 0.65 * fadeMid);
  float dR = pow(texture2D(u_sdf, clamp(v_uv + refr * 1.15, 0.0, 1.0)).r, u_dgamma);
  float dG = pow(texture2D(u_sdf, clamp(v_uv + refr,        0.0, 1.0)).r, u_dgamma);
  float dB = pow(texture2D(u_sdf, clamp(v_uv + refr * 0.85, 0.0, 1.0)).r, u_dgamma);
  dR = clamp(mix(dR, 0.78, farBlend) + wobble, 0.0, 1.0);
  dG = clamp(mix(dG, 0.78, farBlend) + wobble, 0.0, 1.0);
  dB = clamp(mix(dB, 0.78, farBlend) + wobble, 0.0, 1.0);

  vec3 L = normalize(vec3(u_sun.x, u_sun.y, 0.55));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float ndh = max(dot(N, H), 0.0);
  float spec = pow(ndh, 90.0) + pow(ndh, 16.0) * u_broad;
  float sparkle = pow(vnoise(qd * 40.0 + fl * td * 3.0), 6.0) * (1.5 + u_rain * 2.5) * u_sparkle * fadeFine;
  spec *= 0.55 + sparkle;

  // body color: depth ramp built PER CHANNEL from the dispersed taps (that is
  // the chromatic fringing) + slow current bands drifting downstream
  float band = fbm(qw * 2.0 - fl * tw * (0.25 + u_scroll * 0.35)) * 0.5 + 0.5;
  vec3 body;
  body.r = mix(u_shallow.r, u_deep.r, smoothstep(u_ramp.x * zcSoft, u_ramp.y * zcSoft, dR));
  body.g = mix(u_shallow.g, u_deep.g, smoothstep(u_ramp.x * zcSoft, u_ramp.y * zcSoft, dG));
  body.b = mix(u_shallow.b, u_deep.b, smoothstep(u_ramp.x * zcSoft, u_ramp.y * zcSoft, dB));
  body *= 0.86 + 0.27 * band;

  // caustic shimmer in the shallows, warped by ±refr*8 so the two
  // counter-scrolling fields dance with the refraction instead of sliding
  // past it (reference 8.0 at u_detail 1, capped so high zoom stays sane)
  vec2 warp = refr * min(8.0 * u_detail, 32.0);
  float ca = fbm(qd * 5.5 - fl * td * (0.5 + u_scroll) + warp) + fbm(qd * 5.5 + fl * td * (0.5 + u_scroll) + 4.7 - warp);
  ca = pow(max(ca * 0.5 + 0.5, 0.0), 5.0);
  float shallowMask = 1.0 - smoothstep(0.05 * zc, 0.55 * zc, depth);
  body += ca * shallowMask * vec3(0.30, 0.42, 0.40) * 0.7 * u_caustic * mix(1.0, 0.45, 1.0 - zc) * fadeFine;

  // wave faces catch/lose light -- the moving light-and-dark banding that makes
  // the bed read as flowing water. Applied to the body BEFORE the sky mix so
  // reflected sky stays clean.
  body *= 1.0 + u_wave * fadeMid * (N.x * L.x + N.y * L.y) * (0.35 + 0.65 * depth);

  // foam: bright band hugging the banks + noisy streaks
  float fn = fbm(qd * 7.0 - fl * td * (0.8 + u_scroll));
  float fw = u_foamw * zc;
  float edgeFoam = (1.0 - smoothstep(0.0, 0.085 * fw, depth)) * (0.55 + 0.45 * fn);
  edgeFoam += (1.0 - smoothstep(0.02 * fw, 0.16 * fw, depth)) * smoothstep(0.35, 0.7, fn) * 0.5;
  edgeFoam *= u_foamk * mix(0.15, 1.0, fadeMid);

  // ---- reflection: Fresnel-weighted procedural sky -------------------------
  // Physical base of 4% for calm water plus a wave-facet term, so facets
  // tilted away from the top-down viewer pick up sky while calm flats keep
  // showing the refracted bed. Under map pitch the upper (towards-horizon)
  // screen is at grazing incidence and mirrors much more sky: u_pitch x
  // (1 - 0.55 * v_scr.y). The wave-driven part is footprint-faded so far
  // pitched water cannot haze out; the grazing part is not faded -- horizon
  // glare is exactly what should survive into the distance.
  float cosT = max(N.z, 0.0);
  float fres = 0.04 + 0.46 * pow(1.0 - cosT, 3.0) * (0.4 + 0.6 * fadeMid);
  float grazing = u_pitch * (1.0 - 0.55 * clamp(v_scr.y, 0.0, 1.0));
  fres = clamp((fres + 0.30 * grazing) * u_refl, 0.0, 0.62);
  // the reflected ray looks up a two-stop sky: horizon colour low, zenith high
  vec3 R = reflect(-vec3(0.0, 0.0, 1.0), N);
  float skyMix = clamp(R.y * 1.4 + 0.5, 0.0, 1.0);
  vec3 sky = mix(u_skyH, u_skyZ, pow(skyMix, 0.75));
  // warm glow around the sun's mirror position (u_sun is bearing-compensated,
  // so the glow sweeps across the facets when the map is rotated)
  float sunGlow = pow(max(dot(normalize(vec3(R.xy, 0.55)), normalize(vec3(u_sun, 0.55))), 0.0), 10.0);
  sky += vec3(1.0, 0.9, 0.72) * sunGlow * 0.55;

  // composite: refracted bed vs reflected sky, by Fresnel. Foam bands and the
  // sun glint stay additive ON TOP of the mix; alpha handling is untouched.
  vec3 col = mix(body, sky, fres);
  col += u_foam * edgeFoam * 0.9;
  col += vec3(1.0, 0.98, 0.9) * spec * u_glint * (0.5 + 0.5 * depth) * mix(0.25, 1.0, fadeMid);

  // opacity: deeper water more opaque, foam adds cover; u_alpha is the
  // user-controlled multiplier from setOpacity() (1.0 = palette default)
  float a = u_op * (0.72 + 0.28 * smoothstep(0.0, 0.5, depth));
  a = min(a + edgeFoam * 0.35, 0.95);
  a *= u_alpha;
  // staged inundation reveal (setGrow + per-feature 'reveal' delay): while
  // u_grow passes [u_growStart, u_growStart+0.16] the polygon fills from its
  // interior (deepest from the mapped bank = lowest ground) out to its
  // shoreline; the front keeps a 0.12 soft edge. Inactive polygons take the
  // gcov == 1.0 path, so every default use renders bit for bit as before.
  float gcov = 1.0;
  float gfront = 0.0;
  if (u_growStart >= 0.0) {
    float f = clamp((u_grow - u_growStart) / 0.16, 0.0, 1.0);
    float h = 1.0 - 1.12 * f;
    gcov = smoothstep(h - 0.12, h + 0.12, depth);
    // a luminous lip riding the advancing front, so the creeping waterline is
    // legible even where filled interiors go near-black on dark basemaps;
    // it fades out as the sheet completes (f>=1 -> h<0, band sits at the bank)
    gfront = smoothstep(h - 0.02, h + 0.02, depth) * (1.0 - smoothstep(h + 0.10, h + 0.30, depth));
    gfront *= step(0.002, f) * step(f, 0.998);
  }
  col += u_foam * gfront;
  a = min(a + gfront * 0.45, 0.95);
  gl_FragColor = vec4(col * a * gcov, a * gcov);
}`;

/**
 * Look presets. `spec` is neutral and reproduces the original shader byte for
 * byte; `realistic` (default) tames the three terms that blow out to white on
 * real river geometry -- the bank foam band, the shallow caustics and the
 * shallow end of the colour ramp -- and lets ripple detail follow zoom.
 */
export const LOOKS = {
  // refract: multiplier of the 0.028 uv reference bend. reflect: multiplier of
  // the palette's refl. Both 0 in `spec` => the original shader, bit for bit.
  spec:      { dgamma: 1.0,  foam: 1.0,  foamWidth: 1.0,  caustic: 1.0,  sparkle: 1.0,  ramp: [0.12, 0.75], detail: false, maxDetail: 1,  detailDiv: 1100, dnoise: 0.0,  wave: 0.0,  broad: 0.0,  refract: 0.0, reflect: 0.0 },
  realistic: { dgamma: 0.62, foam: 0.30, foamWidth: 0.40, caustic: 0.30, sparkle: 0.45, ramp: [0.05, 0.50], detail: true,  maxDetail: 20, detailDiv: 850,  dnoise: 0.10, wave: 0.30, broad: 0.35, refract: 1.0, reflect: 1.0 },
  glassy:    { dgamma: 0.55, foam: 0.12, foamWidth: 0.28, caustic: 0.15, sparkle: 0.25, ramp: [0.03, 0.42], detail: true,  maxDetail: 20, detailDiv: 850,  dnoise: 0.08, wave: 0.22, broad: 0.22, refract: 0.6, reflect: 1.15 },
};

// Position-only program used for the stencil mask passes.
const MASK_VERT = `precision highp float;
attribute vec2 a_pos;
uniform vec2 u_res;
uniform vec3 u_persp;          // must match VERT or the stencil would not line up
void main(){
  vec2 c = (a_pos / u_res) * 2.0 - 1.0;
  float q = max(u_persp.x + u_persp.y * a_pos.x + u_persp.z * a_pos.y, 1e-3);
  float wq = 1.0 / q;
  gl_Position = vec4(c.x * wq, -c.y * wq, 0.0, wq);
}`;

const MASK_FRAG = `precision mediump float;
void main(){ gl_FragColor = vec4(0.0); }`;

/* --------------------------------------------------------------- gl helpers */

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`[waterSurface] ${label} shader failed to compile:\n${log}`);
  }
  return s;
}

function link(gl, vsSrc, fsSrc, label) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${label} vertex`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label} fragment`);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`[waterSurface] ${label} program failed to link:\n${log}`);
  }
  return p;
}

/* ------------------------------------------------- geometry / ring utilities */

const TAU = Math.PI * 2;

function dedupeRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-12 || Math.abs(q[1] - p[1]) > 1e-12) out.push([p[0], p[1]]);
  }
  // GeoJSON rings repeat the first point; drop the duplicate closing vertex
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) out.pop();
    else break;
  }
  return out;
}

/** Douglas–Peucker on a closed ring (returns a new open ring). */
function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n < 8 || tol <= 0) return ring;
  const tol2 = tol * tol;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  // split the ring at the vertex farthest from vertex 0 so DP has two arcs
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const dx = ring[i][0] - ring[0][0], dy = ring[i][1] - ring[0][1];
    const d = dx * dx + dy * dy;
    if (d > fd) { fd = d; far = i; }
  }
  keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const eI = e === n ? 0 : e;
    if (e - s < 2) continue;
    const ax = ring[s][0], ay = ring[s][1];
    const bx = ring[eI][0], by = ring[eI][1];
    const ddx = bx - ax, ddy = by - ay;
    const len2 = ddx * ddx + ddy * ddy;
    let idx = -1, maxd = tol2;
    for (let i = s + 1; i < e; i++) {
      const px = ring[i][0] - ax, py = ring[i][1] - ay;
      let d;
      if (len2 > 0) {
        let t = (px * ddx + py * ddy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = px - ddx * t, cy = py - ddy * t;
        d = cx * cx + cy * cy;
      } else {
        d = px * px + py * py;
      }
      if (d > maxd) { maxd = d; idx = i; }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out.length >= 3 ? out : ring;
}

/* ------------------------------------------------------------------- the SDF */

/**
 * Signed-distance-to-bank raster for one polygon, in the polygon's bbox uv
 * space. Texel = distance to the nearest boundary point (0 at the very edge),
 * normalized `min(255, round(dist / (maxDist * 0.75) * 255))` so most of the
 * interior saturates to "deep" well before the true maximum distance.
 *
 * Distances are computed with an exact separable (Felzenszwalb–Huttenlocher)
 * Euclidean distance transform, with per-axis pixel sizes so the metric stays
 * isotropic on the ground even for long, thin, aspect-extreme reaches.
 */
// scratch buffers reused across polygons (SDF building allocates a lot otherwise)
const SCRATCH = { size: 0, inside: null, bank: null, grid: null, line: 0, f: null, d: null, v: null, z: null };
function scratch(W, H) {
  const n = W * H, m = Math.max(W, H);
  if (SCRATCH.size < n) {
    SCRATCH.size = n;
    SCRATCH.inside = new Uint8Array(n);
    SCRATCH.bank = new Uint8Array(n);
    SCRATCH.grid = new Float64Array(n);
    SCRATCH.lref = new Float64Array(n);
    SCRATCH.tmpf = new Float64Array(n);
  } else {
    SCRATCH.inside.fill(0, 0, n);
    SCRATCH.bank.fill(0, 0, n);
  }
  if (SCRATCH.line < m) {
    SCRATCH.line = m;
    SCRATCH.f = new Float64Array(m);
    SCRATCH.d = new Float64Array(m);
    SCRATCH.v = new Int32Array(m);
    SCRATCH.z = new Float64Array(m + 1);
  }
  return SCRATCH;
}

/**
 * Local channel width, in the same units as the distance field.
 *
 * Dividing every texel by one number per polygon (the spec's maxDist) means a
 * 40 km reach is normalised by its widest pool: a 200 m side channel then never
 * gets past the "shallow / foam" end of the ramp and renders as a pale band --
 * which is what a braided river or a long pitched view is mostly made of.
 * Taking the max of the distance field over a neighbourhood the size of the
 * channel gives a *local* reference instead, so every channel spans the full
 * depth range. Two separable passes (sliding max, then box mean to keep it
 * smooth), both O(W*H).
 */
function localWidthField(grid, out, tmp, W, H, rx, ry) {
  const N = W * H;
  // sliding max along x
  for (let y = 0; y < H; y++) {
    const r = y * W;
    let lo = 0, hi = 0, best = -1, bestI = -1;
    for (let x = 0; x < W; x++) {
      lo = x - rx < 0 ? 0 : x - rx;
      hi = x + rx > W - 1 ? W - 1 : x + rx;
      if (bestI < lo) {                     // recompute when the max leaves
        best = -1;
        for (let k = lo; k <= hi; k++) if (grid[r + k] > best) { best = grid[r + k]; bestI = k; }
      } else if (grid[r + hi] >= best) { best = grid[r + hi]; bestI = hi; }
      tmp[r + x] = best;
    }
  }
  // sliding max along y
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0, best = -1, bestI = -1;
    for (let y = 0; y < H; y++) {
      lo = y - ry < 0 ? 0 : y - ry;
      hi = y + ry > H - 1 ? H - 1 : y + ry;
      if (bestI < lo) {
        best = -1;
        for (let k = lo; k <= hi; k++) { const val = tmp[k * W + x]; if (val > best) { best = val; bestI = k; } }
      } else { const val = tmp[hi * W + x]; if (val >= best) { best = val; bestI = hi; } }
      out[y * W + x] = best;
    }
  }
  // box mean (prefix sums) so the normaliser has no hard steps
  for (let y = 0; y < H; y++) {
    const r = y * W;
    let acc = 0;
    for (let x = 0; x < W; x++) { acc += out[r + x]; tmp[r + x] = acc; }
    for (let x = 0; x < W; x++) {
      const lo = x - rx < 0 ? 0 : x - rx, hi = x + rx > W - 1 ? W - 1 : x + rx;
      out[r + x] = (tmp[r + hi] - (lo > 0 ? tmp[r + lo - 1] : 0)) / (hi - lo + 1);
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = 0; y < H; y++) { acc += out[y * W + x]; tmp[y * W + x] = acc; }
    for (let y = 0; y < H; y++) {
      const lo = y - ry < 0 ? 0 : y - ry, hi = y + ry > H - 1 ? H - 1 : y + ry;
      out[y * W + x] = (tmp[hi * W + x] - (lo > 0 ? tmp[(lo - 1) * W + x] : 0)) / (hi - lo + 1);
    }
  }
  return out;
}

function buildSdf(rings, bbox, maxSide, minSide, metersPerTexel, pct, openEdges, local) {
  const [minX, minY, maxX, maxY] = bbox;
  const latMid = (minY + maxY) / 2;
  const wSpan = (maxX - minX) * Math.cos((latMid * Math.PI) / 180);
  const hSpan = maxY - minY;
  const aspect = wSpan / hSpan;
  if (metersPerTexel > 0) {
    // Adaptive resolution: the spec's flat ~224px cap starves long braided
    // reaches (a 300 m channel lands on ~3 texels and the whole river reads as
    // bank/foam). Aim for a fixed ground resolution instead, still capped.
    // Floor of 24 (not the 640-side max): thousands of small flood ponds each
    // asking for 96x96 texels would blow texture memory for no visible gain.
    const longSideM = Math.max(wSpan, hSpan) * 110540;   // spans are in degrees
    maxSide = Math.max(24, Math.min(maxSide, Math.round(longSideM / metersPerTexel)));
  }
  let W, H;
  if (aspect >= 1) {
    W = maxSide;
    H = Math.max(minSide, Math.min(maxSide, Math.round(maxSide / aspect)));
  } else {
    H = maxSide;
    W = Math.max(minSide, Math.min(maxSide, Math.round(maxSide * aspect)));
  }

  // --- rasterize interior (even-odd scanline over all rings, in uv space)
  const S = scratch(W, H);
  const N = W * H;                     // scratch buffers may be larger than this
  const inside = S.inside;
  const xs = [];
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) / H;
    xs.length = 0;
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ay = (ring[j][1] - minY) / (maxY - minY);
        const by = (ring[i][1] - minY) / (maxY - minY);
        if ((ay > sy) === (by > sy)) continue;
        const ax = (ring[j][0] - minX) / (maxX - minX);
        const bx = (ring[i][0] - minX) / (maxX - minX);
        xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    const row = y * W;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let x0 = Math.ceil(xs[k] * W - 0.5);
      let x1 = Math.floor(xs[k + 1] * W - 0.5);
      if (x0 < 0) x0 = 0;
      if (x1 > W - 1) x1 = W - 1;
      for (let x = x0; x <= x1; x++) inside[row + x] = 1;
    }
  }

  // --- rasterize the *banks*: every boundary segment except the ones the caller
  // flagged as open (the straight upstream/downstream cuts where a long river was
  // sliced into reaches). Seeding the distance transform from real banks only is
  // what stops a bright foam band from appearing across the river at every join.
  const bank = S.bank;
  const isOpen = (mx, my) => {
    if (!openEdges || !openEdges.length) return false;
    for (const e of openEdges) {
      const ax = e[0][0], ay = e[0][1], bx = e[1][0], by = e[1][1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((mx - ax) * dx + (my - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = mx - (ax + dx * t), cy = my - (ay + dy * t);
      if (Math.hypot(cx, cy) <= Math.sqrt(len2) * 0.08 + 1e-9) return true;
    }
    return false;
  };
  let nBank = 0;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const A = ring[j], B = ring[i];
      if (isOpen((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)) continue;
      const ax = ((A[0] - minX) / (maxX - minX)) * W - 0.5;
      const ay = ((A[1] - minY) / (maxY - minY)) * H - 0.5;
      const bx = ((B[0] - minX) / (maxX - minX)) * W - 0.5;
      const by = ((B[1] - minY) / (maxY - minY)) * H - 0.5;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const px = Math.round(ax + (bx - ax) * t);
        const py = Math.round(ay + (by - ay) * t);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        if (!bank[py * W + px]) { bank[py * W + px] = 1; nBank++; }
      }
    }
  }
  if (!nBank) for (let i = 0; i < N; i++) if (!inside[i]) bank[i] = 1;

  // --- squared EDT to the nearest bank texel
  const INF = 1e20;
  const f = S.f, d = S.d, v = S.v, z = S.z, grid = S.grid;
  for (let i = 0; i < N; i++) grid[i] = bank[i] ? 0 : INF;

  const sx = wSpan / W;   // ground size of one texel in x
  const sy2 = hSpan / H;  // ground size of one texel in y

  const dt1d = (n, scale) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    const s2 = scale * scale;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + s2 * q * q) - (f[v[k]] + s2 * v[k] * v[k])) / (2 * s2 * (q - v[k]));
      while (s <= z[k]) {
        k--;
        s = ((f[q] + s2 * q * q) - (f[v[k]] + s2 * v[k] * v[k])) / (2 * s2 * (q - v[k]));
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = s2 * dq * dq + f[v[k]];
    }
  };

  for (let y = 0; y < H; y++) {           // rows
    const row = y * W;
    for (let x = 0; x < W; x++) f[x] = grid[row + x];
    dt1d(W, sx);
    for (let x = 0; x < W; x++) grid[row + x] = d[x];
  }
  for (let x = 0; x < W; x++) {           // columns
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    dt1d(H, sy2);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }

  let maxDist = 0, nIn = 0;
  for (let i = 0; i < N; i++) {
    if (!inside[i]) { grid[i] = 0; continue; }
    const dist = Math.sqrt(grid[i]);
    grid[i] = dist;
    nIn++;
    if (dist > maxDist) maxDist = dist;
  }

  // Reference distance for the normalisation. The spec divides by the true
  // maxDist; on a braided reach one wide pool then defines "deep" for the whole
  // feature and every side channel collapses into the foam band. A high
  // percentile keeps the intended "interior saturates early" behaviour but stays
  // robust to that. pct = 1 reproduces the literal spec formula.
  let ref = maxDist;
  if (pct < 1 && nIn > 0 && maxDist > 0) {
    const BINS = 512;
    const hist = new Uint32Array(BINS);
    for (let i = 0; i < N; i++) {
      if (!inside[i]) continue;
      hist[Math.min(BINS - 1, (grid[i] / maxDist * (BINS - 1)) | 0)]++;
    }
    let acc = 0;
    const target = nIn * pct;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b];
      if (acc >= target) { ref = ((b + 0.5) / (BINS - 1)) * maxDist; break; }
    }
  }

  const data = new Uint8Array(W * H);
  const denom = Math.max(ref * 0.75, 1e-9);
  const blend = Math.max(0, Math.min(1, local === undefined ? 0 : local));
  if (blend > 0 && ref > 0) {
    // neighbourhood ~ one channel width across
    const rx = Math.max(2, Math.min(64, Math.round(ref / sx)));
    const ry = Math.max(2, Math.min(64, Math.round(ref / sy2)));
    const lref = localWidthField(grid, S.lref, S.tmpf, W, H, rx, ry);
    const floor = ref * 0.22;               // never amplify noise in puddles
    for (let i = 0; i < data.length; i++) {
      const li = lref[i] > floor ? lref[i] : floor;
      const dn = Math.max((ref + (li - ref) * blend) * 0.75, 1e-9);
      data[i] = Math.min(255, Math.round((grid[i] / dn) * 255));
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.min(255, Math.round((grid[i] / denom) * 255));
    }
  }

  // 3x3 box blur (separable, interior only): the depth ramp is sampled with LINEAR
  // filtering and steep gamma, which otherwise makes single texels visible as
  // faceted diamonds along the banks.
  if (W > 4 && H > 4) {
    const tmp = S.blur && S.blur.length >= N ? S.blur : (S.blur = new Uint8Array(Math.max(N, 1)));
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        const a = data[r + (x > 0 ? x - 1 : 0)], b = data[r + x], c = data[r + (x < W - 1 ? x + 1 : W - 1)];
        tmp[r + x] = (a + b + b + c) >> 2;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const a = tmp[(y > 0 ? y - 1 : 0) * W + x], b = tmp[y * W + x], c = tmp[(y < H - 1 ? y + 1 : H - 1) * W + x];
        data[y * W + x] = Math.min(data[y * W + x], (a + b + b + c) >> 2);
      }
    }
  }
  return { data, W, H, maxDist, ref };
}

/* --------------------------------------------------------------- the surface */

export function createWaterSurface(defaults = {}) {
  let gl = null;
  let canvas = null;
  let earcut = null;
  let polys = [];
  let palette = PALETTES.terrain;
  let paletteName = 'terrain';
  let look = { ...LOOKS[defaults.look || 'realistic'] };
  let lookName = defaults.look || 'realistic';
  // user opacity multiplier applied on top of the palette opacity (setOpacity)
  let userOpacity = defaults.opacity == null ? 1 : Math.max(0, Math.min(1, defaults.opacity));
  // staged-inundation clock (setGrow); 1.0 = all staged polygons fully spread
  let growT = 1.0;
  let time = 0;
  let rain = 0;
  let paused = false;
  let pixelRatio = defaults.pixelRatio || 1;
  let lodEnabled = defaults.lod !== false;
  let dedupeOverlap = defaults.dedupeOverlap !== false;
  let sdfMaxSide = defaults.sdfMaxSide || 640;          // spec: ~224 flat cap
  // how much of the depth normalisation is local channel width vs the
  // polygon-wide reference; 0 = the spec's single divisor
  let sdfLocal = defaults.sdfLocal === undefined ? 0 : defaults.sdfLocal;
  let sdfMinSide = defaults.sdfMinSide || 12;
  // 0 => honour sdfMaxSide for every polygon (the literal spec behaviour)
  // >0 caps the ground resolution (coarser rasters for big features, saves memory);
  // 0 gives every polygon the full sdfMaxSide raster, which is what small braided
  // channels need to show any depth gradient at all
  let sdfMetersPerTexel = defaults.sdfMetersPerTexel != null ? defaults.sdfMetersPerTexel : 0;
  // depth reference percentile; 1 = the literal spec (divide by the true max)
  let sdfPercentile = defaults.sdfPercentile != null ? defaults.sdfPercentile : 0.9;
  let cullMargin = defaults.cullMargin || 96;
  let projectionDirty = true;
  let perspOn = defaults.perspective !== false;   // perspective-correct v_uv
  let perspWhy = '';
  let perspSample = null;      // ground point used to probe the projection
  let persp = null;            // [c0,c1,c2] with 1/w = c0 + c1*x + c2*y
  // map pitch in degrees -> u_pitch (0..1 over 0..60deg). Set with setPitch()
  // or the optional 5th render() argument; 0 = top-down, no grazing boost.
  let pitchDeg = defaults.pitch || 0;
  let probes = null;         // geo probe points used to auto-detect camera moves
  let probeSig = null;
  let prog = null, maskProg = null;
  let loc = {}, maskLoc = {};
  const stats = { polygons: 0, drawn: 0, vertices: 0, triangles: 0, projections: 0, lastProjectMs: 0 };

  // simplification tolerances (degrees) for the LOD chain; index 0 = full detail
  const LOD_TOL = defaults.lodTolerances || [0, 2.5e-4, 1.0e-3, 4.0e-3];

  /* ------------------------------------------------------------------ init */

  function init(glContext, canvasEl, opts = {}) {
    gl = glContext;
    canvas = canvasEl;
    earcut = opts.earcut || defaults.earcut || (typeof globalThis !== 'undefined' && globalThis.earcut);
    if (typeof earcut !== 'function') {
      throw new Error('[waterSurface] init() needs a triangulator: init(gl, canvas, { earcut })');
    }
    if (opts.pixelRatio) pixelRatio = opts.pixelRatio;
    // derivatives let the fragment shader fade detail it can no longer resolve
    // (WebGL1 needs the extension enabled before the shader compiles; WebGL2
    // has them in core and the #extension line is ignored)
    gl.getExtension('OES_standard_derivatives');
    prog = link(gl, VERT, FRAG, 'surface');
    maskProg = link(gl, MASK_VERT, MASK_FRAG, 'mask');
    loc = {
      a_uv: gl.getAttribLocation(prog, 'a_uv'),
      a_pos: gl.getAttribLocation(prog, 'a_pos'),
      u_res: gl.getUniformLocation(prog, 'u_res'),
      u_persp: gl.getUniformLocation(prog, 'u_persp'),
      u_sdf: gl.getUniformLocation(prog, 'u_sdf'),
      u_time: gl.getUniformLocation(prog, 'u_time'),
      u_flow: gl.getUniformLocation(prog, 'u_flow'),
      u_scroll: gl.getUniformLocation(prog, 'u_scroll'),
      u_deep: gl.getUniformLocation(prog, 'u_deep'),
      u_shallow: gl.getUniformLocation(prog, 'u_shallow'),
      u_foam: gl.getUniformLocation(prog, 'u_foam'),
      u_op: gl.getUniformLocation(prog, 'u_op'),
      u_sun: gl.getUniformLocation(prog, 'u_sun'),
      u_glint: gl.getUniformLocation(prog, 'u_glint'),
      u_rain: gl.getUniformLocation(prog, 'u_rain'),
      u_dgamma: gl.getUniformLocation(prog, 'u_dgamma'),
      u_foamk: gl.getUniformLocation(prog, 'u_foamk'),
      u_foamw: gl.getUniformLocation(prog, 'u_foamw'),
      u_caustic: gl.getUniformLocation(prog, 'u_caustic'),
      u_sparkle: gl.getUniformLocation(prog, 'u_sparkle'),
      u_ramp: gl.getUniformLocation(prog, 'u_ramp'),
      u_detail: gl.getUniformLocation(prog, 'u_detail'),
      u_dnoise: gl.getUniformLocation(prog, 'u_dnoise'),
      u_wave: gl.getUniformLocation(prog, 'u_wave'),
      u_broad: gl.getUniformLocation(prog, 'u_broad'),
      u_sdftex: gl.getUniformLocation(prog, 'u_sdftex'),
      u_refract: gl.getUniformLocation(prog, 'u_refract'),
      u_reflect: gl.getUniformLocation(prog, 'u_reflect'),
      u_skyH: gl.getUniformLocation(prog, 'u_skyH'),
      u_skyZ: gl.getUniformLocation(prog, 'u_skyZ'),
      u_refl: gl.getUniformLocation(prog, 'u_refl'),
      u_pitch: gl.getUniformLocation(prog, 'u_pitch'),
      u_alpha: gl.getUniformLocation(prog, 'u_alpha'),
      u_grow: gl.getUniformLocation(prog, 'u_grow'),
      u_growStart: gl.getUniformLocation(prog, 'u_growStart'),
    };
    maskLoc = {
      a_pos: gl.getAttribLocation(maskProg, 'a_pos'),
      u_res: gl.getUniformLocation(maskProg, 'u_res'),
      u_persp: gl.getUniformLocation(maskProg, 'u_persp'),
    };
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    return api;
  }

  /* ---------------------------------------------------------- setPolygons */

  function resolve(source, feature, index, fallback) {
    let v;
    if (typeof source === 'function') v = source(feature, index);
    else if (source instanceof Map) v = source.get(feature.id != null ? feature.id : index);
    else if (source && typeof source === 'object') {
      v = source[feature.id != null ? feature.id : index];
      if (v == null) v = source[index];
    }
    if (v == null) v = fallback;
    return Number(v);
  }

  /** dominant-axis bearing (deg) of a ring — used when the caller supplies none.
   *  An axis has two ends; take the southward one (bearing 90..270), so standing
   *  water with no known current (the flood sheets) drifts down-map, the way
   *  Pakistan's plains drain towards the Arabian Sea, instead of uphill. */
  function axisBearing(ring) {
    let cx = 0, cy = 0;
    for (const p of ring) { cx += p[0]; cy += p[1]; }
    cx /= ring.length; cy /= ring.length;
    let sxx = 0, syy = 0, sxy = 0;
    const k = Math.cos((cy * Math.PI) / 180);
    for (const p of ring) {
      const dx = (p[0] - cx) * k, dy = p[1] - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // major axis angle from +x
    const deg = (90 - (theta * 180) / Math.PI + 360) % 360;
    return deg < 90 || deg > 270 ? (deg + 180) % 360 : deg;
  }

  /** exact per-triangle winding in geographic space (earcut normalises its own
   *  output winding, so the ring's orientation cannot be used for this) */
  function triSigns(ring, idx) {
    const s = new Int8Array(idx.length / 3);
    for (let t = 0, k = 0; t < idx.length; t += 3, k++) {
      const a = ring[idx[t]], b = ring[idx[t + 1]], c = ring[idx[t + 2]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      s[k] = cross > 0 ? 1 : cross < 0 ? -1 : 0;
    }
    return s;
  }

  function makeLod(outer, holes, tol) {
    const o = tol > 0 ? simplifyRing(outer, tol) : outer;
    if (o.length < 3) return null;
    const hs = [];
    for (const h of holes) {
      const s = tol > 0 ? simplifyRing(h, tol) : h;
      if (s.length >= 3) hs.push(s);
    }
    // earcut input for the surface mesh: outer ring only (holes are stencilled out)
    const flat = new Float64Array(o.length * 2);
    for (let i = 0; i < o.length; i++) { flat[i * 2] = o[i][0]; flat[i * 2 + 1] = o[i][1]; }
    const idx = earcut(Array.from(flat), null, 2);
    if (idx.length < 3) return null;
    const holeMeshes = hs.map((h) => {
      const fl = [];
      for (const p of h) fl.push(p[0], p[1]);
      const hi = earcut(fl, null, 2);
      return hi.length >= 3
        ? { ring: h, index: new Uint16Array(hi), buffer: null, indexBuffer: null,
            data: new Float32Array(h.length * 2), stride: 2, posOff: 0,
            signs: triSigns(h, hi), draw: null, drawBuf: null, drawCount: hi.length }
        : null;
    }).filter(Boolean);
    return {
      ring: o,
      index: new Uint16Array(idx),
      holes: holeMeshes,
      data: new Float32Array(o.length * 4), // interleaved uv+pos
      stride: 4, posOff: 2,
      signs: triSigns(o, idx),
      draw: null,        // per-frame filtered index buffer (horizon clipping)
      drawBuf: null,
      drawCount: idx.length,
      buffer: null,
      indexBuffer: null,
      uploaded: false,
      uvReady: false,
      tol,
    };
  }

  function addPolygon(coords, feature, index, opts) {
    const outer = dedupeRing(coords[0]);
    if (outer.length < 3) return;
    const holes = [];
    for (let i = 1; i < coords.length; i++) {
      const h = dedupeRing(coords[i]);
      if (h.length >= 3) holes.push(h);
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of outer) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const bw = maxX - minX, bh = maxY - minY;
    if (!(bw > 0) || !(bh > 0)) return;

    const props = feature.properties || {};
    const bearingDeg = resolve(
      opts.bearingByFeature, feature, index,
      props.bearing != null ? props.bearing : axisBearing(outer)
    );
    const avgSpeed = resolve(
      opts.avgSpeedByFeature, feature, index,
      props.speed != null ? props.speed : 1.0
    );

    // u_flow: unit vector of the dominant current, in bbox-normalized uv space
    const br = (bearingDeg * Math.PI) / 180;
    let du = Math.sin(br) * bw;
    let dv = Math.cos(br) * bh;
    const dl = Math.hypot(du, dv) || 1;
    du /= dl; dv /= dl;

    let openEdges = null;
    if (typeof opts.openEdgesByFeature === 'function') openEdges = opts.openEdgesByFeature(feature, index);
    else if (Array.isArray(props.openEdges)) openEdges = props.openEdges;

    // per-feature SDF ground resolution: standing-water datasets (flood
    // sheets, thousands of polygons) cap texel size to keep texture memory
    // bounded; 0 / unset = honour the instance's sdfMaxSide for every polygon
    const mpt = props.sdfMetersPerTexel != null ? +props.sdfMetersPerTexel : sdfMetersPerTexel;
    const sdf = buildSdf([outer, ...holes], [minX, minY, maxX, maxY], sdfMaxSide, sdfMinSide, mpt, sdfPercentile, openEdges, sdfLocal);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, sdf.W, sdf.H, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, sdf.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const lods = [];
    for (const tol of (lodEnabled ? LOD_TOL : [0])) {
      // skip tolerances that would collapse the ring below usable detail
      const l = makeLod(outer, holes, tol);
      if (l && (!lods.length || l.ring.length < lods[lods.length - 1].ring.length * 0.92)) lods.push(l);
    }
    if (!lods.length) return;

    // 9 probe points (bbox corners, edge midpoints, centre): projected first as a
    // cheap visibility test. More than 4 because a perspective (pitched) camera is
    // not affine — the ring can project outside the quad formed by the corners.
    const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
    polys.push({
      feature, index,
      name: props.name || props.river || `feature ${index}`,
      bbox: [minX, minY, maxX, maxY],
      corners: [[minX, minY], [mx, minY], [maxX, minY], [maxX, my],
                [maxX, maxY], [mx, maxY], [minX, maxY], [minX, my], [mx, my]],
      flow: [du, dv],
      scroll: 0.35 + avgSpeed * 1.6,
      // staged-inundation delay (setGrow); null = always fully spread
      reveal: props.reveal != null ? Math.max(0, Math.min(1, +props.reveal)) : null,
      bearingDeg, avgSpeed,
      sdfTex: tex, sdfSize: [sdf.W, sdf.H], sdfInfo: { W: sdf.W, H: sdf.H, maxDist: sdf.maxDist, ref: sdf.ref },
      lods,
      activeLod: -1,
      screen: [0, 0, 0, 0],
      visible: true,
    });
  }

  function setPolygons(fc, opts = {}) {
    disposePolys();
    polys = [];
    const feats = !fc ? [] : fc.type === 'FeatureCollection' ? fc.features
      : fc.type === 'Feature' ? [fc] : Array.isArray(fc) ? fc : [];
    feats.forEach((f, i) => {
      const g = f && f.geometry;
      if (!g) return;
      if (g.type === 'Polygon') addPolygon(g.coordinates, f, i, opts);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((c) => addPolygon(c, f, i, opts));
    });

    // probe points for auto camera-move detection
    if (polys.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of polys) {
        x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1]);
        x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3]);
      }
      probes = [[x0, y0], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2], [x0, y1]];
    } else {
      probes = null;
    }
    probeSig = null;
    projectionDirty = true;
    stats.polygons = polys.length;
    stats.vertices = polys.reduce((s, p) => s + p.lods[0].ring.length, 0);
    stats.triangles = polys.reduce((s, p) => s + p.lods[0].index.length / 3, 0);
    return api;
  }

  /* --------------------------------------------------------------- palette */

  function setPalette(styleName) {
    palette = PALETTES[styleName] || PALETTES.terrain;
    paletteName = PALETTES[styleName] ? styleName : 'terrain';
    return api;
  }

  /* ------------------------------------------------------------ projection */

  function cameraMoved(projectFn) {
    if (!probes) return false;
    let sig = '';
    for (const g of probes) {
      const s = projectFn(g[0], g[1]);
      sig += `${Math.round(s.x * 8)},${Math.round(s.y * 8)};`;
    }
    if (sig !== probeSig) { probeSig = sig; return true; }
    return false;
  }

  function chooseLod(p, pxPerDegX, pxPerDegY) {
    if (!lodEnabled || p.lods.length === 1) return 0;
    const scale = Math.max(pxPerDegX, pxPerDegY);
    let best = 0;
    for (let i = 0; i < p.lods.length; i++) {
      if (p.lods[i].tol * scale <= 0.55) best = i; // sub-pixel simplification error
      else break;
    }
    return best;
  }

  /**
   * Horizon guard. `map.project()` on a point behind the camera (beyond the
   * horizon of a pitched view) returns a mirrored / astronomically large screen
   * position — a single such vertex drags a triangle across the whole viewport.
   * Neither is representable in 2D screen space, and both are detectable:
   *   * a vertex further out than `WILD` viewport-widths is unusable, and
   *   * a valid map projection preserves triangle winding, so any triangle whose
   *     screen winding flipped relative to its geographic winding has a vertex
   *     behind the camera.
   * Such triangles are dropped for this frame (they live at/behind the horizon,
   * i.e. sub-pixel in the real view) by uploading a filtered index buffer.
   * Fully on-screen meshes skip all of this and use their static index buffer.
   */
  function filterMesh(m, cw, ch) {
    const maxDim = Math.max(cw, ch);
    // triangles reaching further than a few screens away are projection
    // artefacts (a reach running off past the horizon), not geometry anyone
    // can see: keeping them is what stretches pale slabs across a tilted view
    const WILD = maxDim * 3;
    const data = m.data, st = m.stride, off = m.posOff;
    const n = m.ring.length;
    let outside = false, wildAny = false;
    for (let i = 0; i < n; i++) {
      const x = data[i * st + off], y = data[i * st + off + 1];
      if (!(x > -WILD && x < WILD && y > -WILD && y < WILD) || !isFinite(x) || !isFinite(y)) {
        wildAny = true; outside = true; break;
      }
      if (x < 0 || y < 0 || x > cw || y > ch) outside = true;
    }
    if (!outside) { m.drawCount = m.index.length; m.drawBuf = m.indexBuffer; return; }

    const idx = m.index;
    const signs = m.signs;                    // screen y points down => winding flips once
    if (!m.draw || m.draw.length < idx.length) m.draw = new Uint16Array(idx.length);
    const out = m.draw;
    let k = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * st + off, b = idx[t + 1] * st + off, c = idx[t + 2] * st + off;
      const ax = data[a], ay = data[a + 1], bx = data[b], by = data[b + 1], cx = data[c], cy = data[c + 1];
      if (wildAny) {
        if (!(ax > -WILD && ax < WILD && ay > -WILD && ay < WILD) ||
            !(bx > -WILD && bx < WILD && by > -WILD && by < WILD) ||
            !(cx > -WILD && cx < WILD && cy > -WILD && cy < WILD)) continue;
      }
      const geo = signs[t / 3];
      if (geo !== 0) {
        const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(cross) > 1e-3 && Math.sign(cross) !== -geo) continue;
      }
      out[k] = idx[t]; out[k + 1] = idx[t + 1]; out[k + 2] = idx[t + 2]; k += 3;
    }
    m.drawCount = k;
    if (!m.dynBuffer) m.dynBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.dynBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, out.subarray(0, k), gl.DYNAMIC_DRAW);
    m.drawBuf = m.dynBuffer;
  }

  /**
   * Estimate the screen-space perspective denominator.
   *
   * The mesh is rasterised as flat screen-space triangles, so v_uv would
   * interpolate affinely. That is exact for a top-down camera and increasingly
   * wrong as the map is pitched: near-camera fragments end up sampling the
   * wrong part of the depth texture and the surface smears into long streaks.
   *
   * For a planar map, screen <- ground is a homography, so the forward
   * denominator w satisfies: 1/w is an *affine* function of the screen
   * position. Recovering those three coefficients lets the vertex shader put
   * the perspective back (see u_persp in VERT) without changing where a single
   * vertex lands. The local pixel-area scale A of the projection obeys
   * A ~ (1/w)^3, so three probes are enough to fit the plane.
   *
   * Returns [c0, c1, c2] with 1/w = c0 + c1*x + c2*y (pixels), or null when the
   * fit is degenerate / the camera is effectively top-down.
   */
  function estimatePersp(projectFn, cw, ch) {
    perspWhy = '';
    if (!perspSample) { perspWhy = 'nosample'; return null; }
    const [lon0, lat0] = perspSample;
    const P = (lo, la) => {
      const s = projectFn(lo, la);
      return (s && isFinite(s.x) && isFinite(s.y) && Math.abs(s.x) < 5e4 && Math.abs(s.y) < 5e4)
        ? [s.x * pixelRatio, s.y * pixelRatio] : null;
    };
    // area scale (pixels^2 per degree^2) around a ground point
    const area = (lo, la, e) => {
      const a = P(lo, la), b = P(lo + e, la), c = P(lo, la + e);
      if (!a || !b || !c) return null;
      const d = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      return d > 0 ? [a, d] : null;
    };

    for (let attempt = 0, d = 0.004; attempt < 5; attempt++, d *= 3) {
      const e = d * 0.02;
      const s0 = area(lon0, lat0, e);
      const s1 = area(lon0 + d, lat0, e);
      const s2 = area(lon0, lat0 + d, e);
      if (!s0 || !s1 || !s2) { perspWhy = 'probe' + attempt; continue; }
      const pts = [s0, s1, s2];
      // q = 1/w ~ A^(1/3), normalised so that q == 1 at the first probe
      const q = pts.map((p) => Math.cbrt(p[1] / s0[1]));
      const [A, B, C] = pts.map((p) => p[0]);
      const det = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      const spread = Math.max(Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1]),
                              Math.abs(C[0] - A[0]), Math.abs(C[1] - A[1]));
      if (!isFinite(det) || Math.abs(det) < 1e-6 || spread < 24) { perspWhy = 'spread' + attempt + ':' + spread.toFixed(1); continue; }
      const c1 = ((q[1] - q[0]) * (C[1] - A[1]) - (q[2] - q[0]) * (B[1] - A[1])) / det;
      const c2 = ((q[2] - q[0]) * (B[0] - A[0]) - (q[1] - q[0]) * (C[0] - A[0])) / det;
      const c0 = q[0] - c1 * A[0] - c2 * A[1];
      if (![c0, c1, c2].every(isFinite)) continue;
      // near-top-down: the gradient is noise, keep the plain affine path
      const swing = Math.abs(c1) * cw + Math.abs(c2) * ch;
      const mid = c0 + c1 * cw * 0.5 + c2 * ch * 0.5;
      if (!(mid > 0) || swing < 0.02 * Math.abs(mid)) { perspWhy = 'flat mid=' + mid.toFixed(3) + ' swing=' + swing.toFixed(4); return null; }
      // normalise around screen centre and refuse wild extrapolations
      const n = 1 / mid;
      return [c0 * n, c1 * n, c2 * n];
    }
    return null;
  }

  /**
   * Exact per-vertex projection (never an interpolated lon/lat -> screen grid:
   * a coarse approximation looks fine zoomed out but shears the mesh into
   * spiky slivers once zoomed in or pitched). Only runs when the camera has
   * actually moved, so the cost is amortised over many animation frames.
   */
  function reproject(projectFn) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let count = 0;
    const cw = canvas.width, ch = canvas.height;
    let bestD = Infinity, bestSample = null;

    for (const p of polys) {
      // cheap bbox-corner cull before touching the full ring
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, wild = false;
      for (const c of p.corners) {
        const s = projectFn(c[0], c[1]);
        count++;
        if (!isFinite(s.x) || !isFinite(s.y) || Math.abs(s.x) > 5e4 || Math.abs(s.y) > 5e4) { wild = true; break; }
        const sx = s.x * pixelRatio, sy = s.y * pixelRatio;
        if (sx < x0) x0 = sx;
        if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy;
        if (sy > y1) y1 = sy;
        // remember the ground point that lands nearest the canvas centre: the
        // perspective probe has to sit in front of the camera, and a long
        // reach's bbox centre can easily be beyond the horizon
        const dx = sx - cw * 0.5, dy = sy - ch * 0.5, dc = dx * dx + dy * dy;
        if (dc < bestD) { bestD = dc; bestSample = [c[0], c[1]]; }
      }
      if (!wild) {
        const w = x1 - x0, h = y1 - y0;
        const pad = cullMargin;
        if (x1 < -pad || y1 < -pad || x0 > cw + pad || y0 > ch + pad) { p.visible = false; continue; }
        p.pxSpan = Math.max(w, h);
        // clamp the scissor rect to the viewport (a partly off-screen reach is fine)
        x0 = Math.max(x0, -1); y0 = Math.max(y0, -1);
        x1 = Math.min(x1, cw + 1); y1 = Math.min(y1, ch + 1);
      } else {
        x0 = 0; y0 = 0; x1 = cw; y1 = ch;
        p.pxSpan = Math.max(cw, ch) * 2;
      }
      p.visible = true;
      p.screen = [x0, y0, x1, y1];

      const [bx0, by0, bx1, by1] = p.bbox;
      const lod = chooseLod(p, (x1 - x0) / (bx1 - bx0), (y1 - y0) / (by1 - by0));
      p.activeLod = lod;
      const L = p.lods[lod];

      // interleaved vec2 a_uv, vec2 a_pos — uv is static, pos follows the camera
      const ring = L.ring, arr = L.data;
      // true projected extent: under pitch the projection is strongly
      // non-linear, so the 9 corner probes can under-report the on-screen
      // footprint by a wide margin. Growing the scissor rect with the real
      // vertices is what stops a tilted reach from being cut off along a hard
      // horizontal/vertical line near the horizon.
      let vx0 = Infinity, vy0 = Infinity, vx1 = -Infinity, vy1 = -Infinity, anyWild = false;
      for (let i = 0; i < ring.length; i++) {
        const lon = ring[i][0], lat = ring[i][1];
        const s = projectFn(lon, lat);
        const o = i * 4;
        if (!L.uvReady) {
          arr[o] = (lon - bx0) / (bx1 - bx0);
          arr[o + 1] = (lat - by0) / (by1 - by0);
        }
        const px = s.x * pixelRatio, py = s.y * pixelRatio;
        arr[o + 2] = px;
        arr[o + 3] = py;
        if (isFinite(px) && isFinite(py) && Math.abs(px) < 5e4 && Math.abs(py) < 5e4) {
          if (px < vx0) vx0 = px;
          if (px > vx1) vx1 = px;
          if (py < vy0) vy0 = py;
          if (py > vy1) vy1 = py;
        } else {
          anyWild = true;
        }
      }
      // Reprojection is also the only honest visibility test. The corner probes
      // of a 40 km reach can all land tens of thousands of pixels away while
      // the reach still crosses the view, so those polygons are kept -- but a
      // reach that is genuinely off screen must not be: its clamped, partly
      // garbage mesh is what paints pale sheets of water over dry land.
      if (!isFinite(vx0) || vx1 < -cullMargin || vy1 < -cullMargin ||
          vx0 > cw + cullMargin || vy0 > ch + cullMargin) {
        p.visible = false;
        continue;
      }
      {
        const sc = p.screen;
        sc[0] = Math.max(anyWild ? 0 : Math.min(sc[0], vx0), -1);
        sc[1] = Math.max(anyWild ? 0 : Math.min(sc[1], vy0), -1);
        sc[2] = Math.min(anyWild ? cw : Math.max(sc[2], vx1), cw + 1);
        sc[3] = Math.min(anyWild ? ch : Math.max(sc[3], vy1), ch + 1);
        if (!wild) p.pxSpan = Math.max(p.pxSpan, Math.min(vx1 - vx0, cw * 4), Math.min(vy1 - vy0, ch * 4));
      }
      L.uvReady = true;
      count += ring.length;

      if (!L.buffer) {
        L.buffer = gl.createBuffer();
        L.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, L.index, gl.STATIC_DRAW);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, L.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      filterMesh(L, cw, ch);

      // hole rings: screen-space-only mask meshes
      for (const hm of L.holes) {
        const hr = hm.ring, hd = hm.data;
        for (let i = 0; i < hr.length; i++) {
          const s = projectFn(hr[i][0], hr[i][1]);
          hd[i * 2] = s.x * pixelRatio;
          hd[i * 2 + 1] = s.y * pixelRatio;
        }
        count += hr.length;
        if (!hm.buffer) {
          hm.buffer = gl.createBuffer();
          hm.indexBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hm.indexBuffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, hm.index, gl.STATIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, hm.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, hd, gl.DYNAMIC_DRAW);
        filterMesh(hm, cw, ch);
      }
    }
    perspSample = bestSample;
    persp = perspOn ? estimatePersp(projectFn, cw, ch) : null;
    stats.persp = persp ? persp.slice() : null;
    stats.perspWhy = perspWhy;
    stats.projections = count;
    stats.lastProjectMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  /* ------------------------------------------------------------------ draw */

  function render(dt, mapBearingDegrees = 0, speedMultiplier = 1, projectFn, pitchDegrees) {
    if (!gl || !prog) return;
    const w = canvas.width, h = canvas.height;
    if (Number.isFinite(pitchDegrees)) pitchDeg = pitchDegrees;

    // §4 animation clock
    if (!paused) {
      const d = Math.min(Math.max(dt || 0, 0), 0.1);
      time += d * (0.35 + 0.65 * speedMultiplier);
    }

    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    if (!polys.length || typeof projectFn !== 'function') return;

    if (projectionDirty || cameraMoved(projectFn)) {
      reproject(projectFn);
      projectionDirty = false;
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // shader outputs premultiplied
    gl.enable(gl.STENCIL_TEST);

    // shared uniforms (§2)
    const az = ((235 - mapBearingDegrees) * Math.PI) / 180;
    gl.useProgram(prog);
    gl.uniform2f(loc.u_res, w, h);
    gl.uniform3f(loc.u_persp, persp ? persp[0] : 1, persp ? persp[1] : 0, persp ? persp[2] : 0);
    gl.uniform2f(loc.u_sun, Math.sin(az), -Math.cos(az));
    gl.uniform1f(loc.u_time, time);
    gl.uniform1f(loc.u_rain, rain);
    gl.uniform1f(loc.u_grow, growT);
    gl.uniform3fv(loc.u_deep, palette.deep);
    gl.uniform3fv(loc.u_shallow, palette.shallow);
    gl.uniform3fv(loc.u_foam, palette.foam);
    gl.uniform1f(loc.u_op, palette.op);
    gl.uniform1f(loc.u_glint, palette.glint);
    gl.uniform1f(loc.u_dgamma, look.dgamma);
    gl.uniform1f(loc.u_foamk, look.foam);
    gl.uniform1f(loc.u_foamw, look.foamWidth);
    gl.uniform1f(loc.u_caustic, look.caustic);
    gl.uniform1f(loc.u_sparkle, look.sparkle);
    gl.uniform2f(loc.u_ramp, look.ramp[0], look.ramp[1]);
    gl.uniform1f(loc.u_dnoise, look.dnoise || 0);
    gl.uniform1f(loc.u_wave, look.wave || 0);
    gl.uniform1f(loc.u_broad, look.broad || 0);
    gl.uniform1f(loc.u_refract, look.refract || 0);
    gl.uniform1f(loc.u_reflect, look.reflect || 0);
    gl.uniform3fv(loc.u_skyH, palette.skyH || [0.78, 0.85, 0.92]);
    gl.uniform3fv(loc.u_skyZ, palette.skyZ || [0.33, 0.51, 0.75]);
    // palette refl (day blue sky vs dim night sky) x the look's own multiplier
    gl.uniform1f(loc.u_refl, (palette.refl == null ? 1 : palette.refl) * (look.reflect || 0));
    gl.uniform1f(loc.u_pitch, Math.max(0, Math.min(1, (pitchDeg || 0) / 60)));
    gl.uniform1f(loc.u_alpha, userOpacity);
    gl.uniform1i(loc.u_sdf, 0);
    gl.useProgram(maskProg);
    gl.uniform2f(maskLoc.u_res, w, h);
    gl.uniform3f(maskLoc.u_persp, persp ? persp[0] : 1, persp ? persp[1] : 0, persp ? persp[2] : 0);

    let drawn = 0;
    for (const p of polys) {
      if (!p.visible || p.activeLod < 0) continue;
      if (p.fill != null && p.fill <= 0.002) continue;   // dry right now (setFills)
      const L = p.lods[p.activeLod];
      if (!L.buffer || !L.drawCount) continue;

      // scissor to this polygon so the per-polygon stencil clear stays cheap
      const sx = Math.max(0, Math.floor(p.screen[0]) - 2);
      const sy = Math.max(0, Math.floor(h - p.screen[3]) - 2);
      const sw = Math.min(w - sx, Math.ceil(p.screen[2] - p.screen[0]) + 4);
      const sh = Math.min(h - sy, Math.ceil(p.screen[3] - p.screen[1]) + 4);
      if (sw <= 0 || sh <= 0) continue;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(sx, sy, sw, sh);

      /* ---- stencil mask pass: outer INCR, every hole DECR (colour writes off) */
      gl.colorMask(false, false, false, false);
      gl.stencilMask(0x0f);                       // low nibble = coverage counter
      gl.clear(gl.STENCIL_BUFFER_BIT);            // clears coverage only (bit 4 kept)
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.useProgram(maskProg);

      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.buffer);
      gl.enableVertexAttribArray(maskLoc.a_pos);
      gl.vertexAttribPointer(maskLoc.a_pos, 2, gl.FLOAT, false, 16, 8);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.drawBuf || L.indexBuffer);
      gl.drawElements(gl.TRIANGLES, L.drawCount, gl.UNSIGNED_SHORT, 0);

      gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR);
      for (const hm of L.holes) {
        if (!hm.drawCount) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, hm.buffer);
        gl.vertexAttribPointer(maskLoc.a_pos, 2, gl.FLOAT, false, 8, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hm.drawBuf || hm.indexBuffer);
        gl.drawElements(gl.TRIANGLES, hm.drawCount, gl.UNSIGNED_SHORT, 0);
      }
      gl.disableVertexAttribArray(maskLoc.a_pos);

      /* ---- surface pass: only where the outer ring covered exactly once ---- */
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0x00);
      // bit 4 = "already painted this frame": keeps overlapping reaches from
      // double-blending into visible seams (set dedupeOverlap:false to disable)
      gl.stencilFunc(gl.EQUAL, 0x01, dedupeOverlap ? 0x1f : 0x0f);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

      gl.useProgram(prog);
      gl.uniform2f(loc.u_flow, p.flow[0], p.flow[1]);
      gl.uniform1f(loc.u_scroll, p.scroll);
      // per-polygon fill (setFills) overrides the shared clock: start 0, clock = fill * window
      if (p.fill != null) { gl.uniform1f(loc.u_growStart, 0.0); gl.uniform1f(loc.u_grow, p.fill * 0.16); }
      else { gl.uniform1f(loc.u_growStart, p.reveal != null ? p.reveal : -1.0); gl.uniform1f(loc.u_grow, growT); }
      // ripple scale follows how many pixels this polygon covers right now
      gl.uniform1f(loc.u_detail, look.detail
        ? Math.max(1, Math.min(look.maxDetail, (p.pxSpan || 0) / (look.detailDiv || 900)))
        : 1);
      gl.uniform2f(loc.u_sdftex, p.sdfSize ? p.sdfSize[0] : 256, p.sdfSize ? p.sdfSize[1] : 256);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, p.sdfTex);
      gl.uniform1i(loc.u_sdf, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.buffer);
      gl.enableVertexAttribArray(loc.a_uv);
      gl.enableVertexAttribArray(loc.a_pos);
      gl.vertexAttribPointer(loc.a_uv, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(loc.a_pos, 2, gl.FLOAT, false, 16, 8);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.drawBuf || L.indexBuffer);
      gl.drawElements(gl.TRIANGLES, L.drawCount, gl.UNSIGNED_SHORT, 0);

      if (dedupeOverlap) {
        // mark the pixels just painted (ref 0x11 & compare mask 0x0f => nibble==1)
        gl.colorMask(false, false, false, false);
        gl.stencilMask(0x10);
        gl.stencilFunc(gl.EQUAL, 0x11, 0x0f);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.useProgram(maskProg);
        gl.enableVertexAttribArray(maskLoc.a_pos);
        gl.vertexAttribPointer(maskLoc.a_pos, 2, gl.FLOAT, false, 16, 8);
        gl.drawElements(gl.TRIANGLES, L.drawCount, gl.UNSIGNED_SHORT, 0);
        gl.disableVertexAttribArray(maskLoc.a_pos);
        gl.colorMask(true, true, true, true);
      }
      drawn++;
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    stats.drawn = drawn;
  }

  /* --------------------------------------------------------------- teardown */

  function disposePolys() {
    if (!gl) return;
    for (const p of polys) {
      gl.deleteTexture(p.sdfTex);
      for (const L of p.lods) {
        if (L.buffer) gl.deleteBuffer(L.buffer);
        if (L.indexBuffer) gl.deleteBuffer(L.indexBuffer);
        if (L.dynBuffer) gl.deleteBuffer(L.dynBuffer);
        for (const hm of L.holes) {
          if (hm.buffer) gl.deleteBuffer(hm.buffer);
          if (hm.indexBuffer) gl.deleteBuffer(hm.indexBuffer);
          if (hm.dynBuffer) gl.deleteBuffer(hm.dynBuffer);
        }
      }
    }
  }

  const api = {
    init,
    setPolygons,
    setPalette,
    render,
    /** force a full re-projection on the next frame (map moved / terrain loaded / resize) */
    invalidateProjection() { projectionDirty = true; return api; },
    setRain(on) { rain = on ? 1 : 0; return api; },
    setPaused(on) { paused = !!on; return api; },
    setPixelRatio(r) { pixelRatio = r || 1; projectionDirty = true; return api; },
    /** paint each screen pixel at most once per frame so overlapping polygons
     *  (e.g. reaches meeting at a confluence) don't double-blend into seams */
    setOverlapDedupe(on) { dedupeOverlap = !!on; return api; },
    /** 'realistic' (default) | 'glassy' | 'spec', or an object of overrides */
    setLook(nameOrOverrides) {
      if (typeof nameOrOverrides === 'string') {
        look = { ...(LOOKS[nameOrOverrides] || LOOKS.realistic) };
        lookName = LOOKS[nameOrOverrides] ? nameOrOverrides : 'realistic';
      } else if (nameOrOverrides && typeof nameOrOverrides === 'object') {
        look = { ...look, ...nameOrOverrides };
        lookName = 'custom';
      }
      return api;
    },
    getLook() { return { name: lookName, ...look }; },
    /** global water opacity multiplier [0..1]; 1 = each palette's own opacity.
     *  Scales the fragment alpha after all shading, so the surface fades
     *  smoothly without changing its colours. */
    setOpacity(v) { userOpacity = Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 1)); return api; },
    getOpacity() { return userOpacity; },
    /** staged-inundation clock [0..1]. Polygons tagged with a `reveal` delay in
     *  their properties (0 = first, ~0.84 = last) fill from their interiors
     *  out to their mapped shoreline while the clock passes their delay;
     *  everything else renders exactly as before. Default 1 (fully spread). */
    setGrow(t) { growT = Math.max(0, Math.min(1, Number.isFinite(+t) ? +t : 1)); return api; },
    /** per-polygon fill [0..1] by feature index (array or fn(index)); a polygon
        with a fill ignores setGrow and fills interior-out to that fraction.
        null / undefined entries fall back to the shared clock. */
    setFills(f) {
      for (const p of polys) {
        const v = typeof f === 'function' ? f(p.index) : f && f[p.index];
        p.fill = v == null ? null : Math.max(0, Math.min(1, +v));
      }
      return api;
    },
    getGrow() { return growT; },
    /** map pitch in degrees — feeds u_pitch (grazing-view reflection boost).
     *  Not needed if you pass map.getPitch() as render()'s 5th argument. */
    setPitch(deg) { pitchDeg = Number.isFinite(+deg) ? +deg : 0; return api; },
    getPitch() { return pitchDeg; },
    /** perspective-correct v_uv under pitch (see u_persp); off = plain
     *  affine screen-space interpolation, i.e. the literal spec path */
    setPerspective(on) { perspOn = !!on; projectionDirty = true; return api; },
    setLod(on) { lodEnabled = !!on; return api; },
    setTime(t) { time = t; return api; },
    getTime() { return time; },
    getPalette() { return paletteName; },
    getPolygons() { return polys; },
    stats() { return { ...stats, time }; },
    dispose() {
      disposePolys();
      polys = [];
      if (gl) {
        if (prog) gl.deleteProgram(prog);
        if (maskProg) gl.deleteProgram(maskProg);
      }
      prog = maskProg = null;
      return api;
    },
  };
  return api;
}

/* Module-level singleton with the API from §7 of the spec. */
const singleton = createWaterSurface();
export const init = (...a) => singleton.init(...a);
export const setPolygons = (...a) => singleton.setPolygons(...a);
export const setPalette = (...a) => singleton.setPalette(...a);
export const render = (...a) => singleton.render(...a);
export const invalidateProjection = () => singleton.invalidateProjection();
export const setRain = (v) => singleton.setRain(v);
export const setPaused = (v) => singleton.setPaused(v);
export const setLook = (v) => singleton.setLook(v);
export const setOpacity = (v) => singleton.setOpacity(v);
export const setGrow = (t) => singleton.setGrow(t);
export const getGrow = () => singleton.getGrow();
export const setPitch = (deg) => singleton.setPitch(deg);
export default singleton;
