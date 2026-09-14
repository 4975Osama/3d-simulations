# Prompt — Animated flood-extent water surface over a map (Cinematic "how the water spread" replay included)

Paste everything below the line into your AI coding assistant (Cursor / Windsurf / Copilot Chat / Claude) inside your project. Replace `<YOUR-...>` placeholders with your project's specifics.

---

## PROJECT CONTEXT (fill these in)

- My project uses: `<YOUR MAP LIB — e.g. MapLibre GL JS / Mapbox GL / Leaflet+WebGL / deck.gl>` and `<YOUR FRAMEWORK>`.
- Target region / dataset: `<YOUR REGION, or keep "Pakistan" below>`.
- Deliverable: `waterSurface.js` — a dependency-light WebGL module that renders **real polygon flood extents as an animated, flowing water surface** on top of my map, plus a demo scene replays how the water spread, region by region.

## 1. DATA PIPELINE (real, authoritative flood extents — never invented polygons)

Source: **UNOSAT FL20220808PAK** from UN OCHA HDX — cumulative VIIRS flood-water mask for the Aug-2022 Pakistan monsoon:
`https://data.humdata.org/dataset/f685e623-a539-4af0-92ff-19b737ec95b3/resource/fa89ec39-8dd0-4abe-b97e-0a3d9e9627a5/download/viirs_20220701_20220831_floodextent_pak.zip`
(backup: `https://unosat-maps.web.cern.ch/PK/FL20220808PAK/FL20220808PAK_SHP.zip`). One multipart polygon, ~344k points, WGS84. For a different event, pick the FL-code from HDX the same way.

Write `build_floods.py` (or Node equivalent) that produces `pk_floods.geojson`:

1. Read the shapefile members, take `unary_union` of all polygons, `buffer(0)` to heal self-intersections.
2. **Morphological closing** `buffer(+d).buffer(-d)` with `d = 0.0030°` (≈330 m) at `resolution=2` (resolution=1 leaves angular tetris-shorelines — avoid), resulting in continuous sheets instead of thousands of ponds.
3. `simplify(0.0010, preserve_topology=True)`, filter out pieces < 0.2 km² and interior holes < 0.1 km² (filter interior rings manually — `remove_small_holes` isn't always available).
4. Clip to the region bbox, explode multipolygons.
5. Properties per feature: `kind: "flood"`, `event`, `sensor`, `source`, `area_km2`, **`speed: 0.15`** (standing water = lazy current), **`sdfMetersPerTexel: 250`** (caps the distance-field texture size for thousands of polygons), and `bearing` if you want a local drift direction.
6. **For the spread replay:** assign each feature `reveal` in [0, 0.84]: order by polygon centroid latitude (north first), i.e. `reveal = (maxLat − lat)/(maxLat − minLat) * 0.84`.

Expected scale: ~3,300 polygons, ~80 k vertices, ~91,000 km² total area. Build time target: one-off < 10 s on a software rasteriser.

## 2. RENDERER ARCHITECTURE (`waterSurface.js`)

A single WebGL (WebGL2 with WebGL1 fallback) layer class with `createWaterSurface()` factory + singleton exports: `init(gl, canvas, {earcut})`, `setPolygons(features, opts)`, `setPalette(name)`, `render(matrix, east, south, west, north, pitchDeg)`, plus the API listed in §5.

Per-polygon compile step (`setPolygons`, done ONCE, not per frame):

1. **Triangulate** each polygon (holes supported) with **earcut** (only dependency; inject it).
2. **Distance-to-bank field (the core simulation):** rasterize an exact Euclidean-distance transform of the bank line into a small texture (~256–640 px, `sdfMaxSide: 640`; per-feature cap via `sdfMetersPerTexel`, adaptive floor 24 texels). Seed only from bank segments (`openEdges` property = holes/open boundaries don't seed); store distance normalized so 0 = bank, 1 = far/deep interior; 3×3 blur; compute `reference` as the **90th percentile** (not max — long tails skew the ramp). This one texture drives: shallow→deep colour ramp, bank foam band, shallow-only caustics, wave damping in the middle, refraction depth weighting, and the spread-replay fill order.
3. **Per-feature flow** uniforms from `bearing` + `speed`: `u_flow` = unit vector of dominant current in bbox-normalized uv; `u_scroll = 0.35 + speed*1.6`.
4. **LOD rings** per polygon at tolerances `[0, 2.5e-4, 1e-3, 4e-3]°`; at draw time pick the coarsest with `tol*pxPerDeg ≤ 0.55`.
5. Reproject per-vertex (each vertex has lng/lat) each camera move into clip space with the map matrix; receive the 4×4 matrix + canvas bounds from the host map (MapLibre custom-layer pattern).

Per-frame draw (`render`):

- Iterate polygons; position-screen-cull by reprojected corners (9 probes bbox test first).
- **Horizon guard: post-reprojection finite-vertex cull — drop triangles whose projected vertices are non-finite or further than 3 viewport widths (`WILD = maxDim*3`) from the viewport** (this is the fix for white/pale garbage ribbons at high zoom/pitch).
- **Stencil clipping:** fill outer ring into stencil (increment / parity: low nibble 0x0f = coverage counter, bit 4 = painted-this-frame), holes decrement; paint surface only where coverage == 1 once, then mark bit 4 so overlapping polygons never double-blend (visible seams otherwise).
- **Perspective-correct interpolation:** restore per-vertex `w` (`q = max(px + py·x + pz·y, 1e-3); gl_Position = vec4(c.x/q, −c.y/q, 0, 1/q)`; null it at pitch 0) or pitched views smear.
- Draw with premultiplied-alpha blending (`blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`), full scissor per polygon.

Performance expectations to hit: < few ms reprojection per camera move for the visible set; hundreds of polygons drawn at continental zoom, 5–20 at close zoom.

## 3. SHADER SIMULATION (vertex-static, all simulation in the fragment shader)

All animation is **stateless** — driven only by `u_time` and the uniforms; no per-frame texture uploads, no particle state. Per-pixel inputs: `v_uv` (bbox-normalized), the SDF texture.

Core look (`spec` preset must reproduce exactly):

- Depth ramp: `mix(u_shallow, u_deep, pow(depth, 0.85))`-style blend driven by the SDF, gamma `DGAMMA` on depth.
- Bank foam: noise-scrolled band, high only where `depth` is small; scrolls counter to `u_flow`.
- Caustics: two counter-scrolling voronoi-ish noise layers, **only over the shallow fringe**, warped by `±refr·8·u_detail` (cap 32).
- Sparkle glints: fine noise, sun-azimuth gated.
- Directional wave trains: phase along `u_flow`, compressed by `u_detail = clamp(pxSpan/detailDiv, 1, maxDetail)` so ripples keep apparent size at any zoom; `zc = 1/max(1, u_detail^0.6)`.

**Refraction** (sample the depth texture through bent rays):

```
bend = N.xy * (0.028*u_refract) * (0.35+0.65*depth) * zcSoft * (0.35+0.65*fadeMid)
// three dispersed taps — chromatic fringe at depth transitions:
dR = sdf(uv + bend*1.15); dG = sdf(uv + bend); dB = sdf(uv + bend*0.85)
// build the shallow→deep ramp colour from each channel's sampled depth
```
`zcSoft = mix(1, zc, 0.85)` — **critical fix**: without bending compensation the zoom-compacted ramp makes R/B taps straddle shallow→deep and you get psychedelic rainbow mottling over shallows. Also fade the bend with `(0.35+0.65*fadeMid)` for far/small features (edge confetti).

**Reflection** (reference-accurate; verify against the acceptance checklist):

```
cosT   = clamp(dot(V, N), 0, 1)
fres   = 0.04 + 0.46 * pow(1 - cosT, 3)          // Schlick-ish, tuned
skyMix = clamp(R.y*1.4 + 0.5, 0, 1)
sky    = mix(u_skyH, u_skyZ, pow(skyMix, 0.75))  // two-stop procedural sky, per-palette
sky   += vec3(1.0, 0.9, 0.72) * pow(max(dot(normalize(vec3(R.xy,0.55)), normalize(vec3(u_sun,0.55))),0),10) * 0.55
grazing= u_pitch * (1 - 0.55*v_scr.y)             // v_scr = a_pos/u_res from vertex shader
fres   = clamp((fres + 0.30*grazing) * u_refl, 0.0, 0.62)
col    = mix(body, sky, fres)
col   += foam_color * edgeFoam * 0.9              // foam + glint additive ON TOP of the mix
col   += vec3(1,0.98,0.9) * spec * u_glint * (0.5+0.5*depth) * mix(0.25,1,fadeMid)
```

Palette fields per style: `deep, shallow, foam, op, glint, skyH, skyZ, refl` (dark style: dim sky, refl ≈ 0.8).

**Distance fads** (must-have for sanity at zoom-out): `foot = max(fwidth(v_uv).x, fwidth(v_uv).y)*3*u_detail`; `fadeFine = clamp(1−foot*28,0,1)` on sparkle+caustics; `fadeMid = clamp(1−foot*7,0,1)` on foam/wave band/spec.

**Opacity**: `a = u_op*(0.72 + 0.28*smoothstep(0,0.5,depth)); a = min(a + edgeFoam*0.35, 0.95); a *= u_alpha;` then premultiply `gl_FragColor = vec4(col*a, a)`.

**Look presets** (one uniform set toggles everything; `spec` = the original look, bit-exact):

| preset | dgamma foam foamW caustic sparkle ramp detail maxD div dnoise wave broad refract reflect |
|---|---|
| spec | 1.0 1.0 1.0 1.0 1.0 [.12,.75] false 1 1100 0 0 0 0 0 |
| realistic | .62 .30 .40 .30 .45 [.05,.50] true 20 850 .10 .30 .35 1.0 1.0 |
| glassy | .55 .12 .28 .15 .25 [.03,.42] true 20 850 .08 .22 .22 0.6 1.15 |

**Rain mode**: extra ripple overlay uniform `u_rain` (impulse rings, cheap hash noise).

## 4. THE STAGED "HOW THE WATER SPREAD" REPLAY (the flood-spread simulation)

Per-feature `reveal` delay [0..1] (north first by latitude) + a global clock `u_grow` (`setGrow(t)`, default 1). Fragment addition at the very end (premultiply preserved; inactive polygons must render **bit-identical** — guard with a branch and multiply by exactly 1.0):

```
float gcov = 1.0, gfront = 0.0;
if (u_growStart >= 0.0) {
  float f = clamp((u_grow - u_growStart) / 0.16, 0.0, 1.0);
  float h = 1.0 - 1.12 * f;
  gcov   = smoothstep(h - 0.12, h + 0.12, depth);              // fill interior → shoreline
  gfront = smoothstep(h-0.02, h+0.02, depth) * (1.0 - smoothstep(h+0.10, h+0.30, depth)); // lit lip
  gfront*= step(0.002, f) * step(f, 0.998);                    // off before start / after complete
}
col += u_foam * gfront;  a = min(a + gfront*0.45, 0.95);
gl_FragColor = vec4(col * a * gcov, a * gcov);
```

Physics narrative: each sheet floods from its interior (lowest ground = farthest from the mapped bank) outward to its shoreline; several lobes pool and merge mid-fill. **The lit lip is essential** — interior-first fill over a dark basemap is invisible without it.

Cinematic choreography (MapLibre `flyTo`, tour pattern):
1. Start camera over the northernmost flood origin (KP/Peshawar belt), pitch ~10, satellite imagery basemap.
2. Start `u_grow` 0 → 1 over ~19 s **during the arrival fly** (start it ≈1200 ms before the fly ends so water is already rising).
3. Simultaneously dive south (MapLibre second `flyTo`, ~22 s) to the biggest standing sheet (Sindh floodplain), ending pitch ~42°, so inundation front and camera sweep arrive together — "we ride the wave south".
4. Dwell ~7 s on the complete sea, then restore everything (`setGrow(1)`).
5. Wrap it in a tour engine with a caption card (scene N/10, progress dots, Prev/Next/Esc, ←/→ keys), which (a) disables all map interactions while running, (b) snapshots *every* user setting before starting — style, palette, look, opacity, dataset, camera, orbit, terrain — and restores it byte-exact on End, and (c) force-applies each scene's look preset (don't rely on UI-button guards, or look overrides leak between scenes).

## 5. PUBLIC API TO SHIP

`init, setPolygons, render, setPalette, setRain, setPaused, setPixelRatio, setTime, setOverlapDedupe, setLod, setLook(name|overrides), getLook, setPerspective(bool), setOpacity/getOpacity, setPitch/getPitch, setGrow/getGrow, stats, dispose, createWaterSurface`. Export unique.palette `PALETTES` + `LOOKS` too. Singleton + factory for multiple layers.

## 6. ACCEPTANCE CHECKLIST (verify all of these)

1. Flood water = the real UNOSAT mask; ~3,300 sheets / ~91,000 km² (region-adjusted after processing); no invented polygons; rivers/floods/both dataset switch works.
2. `setLook('spec')` renders **bit-identical** to the pre-look shader (run an A/B pixel diff = 0).
3. Zero GL errors across zoom 5–15, pitch 0–62°, rotation, satellite + dark + terrain basemaps; no white/pale ribbons or mottled rainbow shallows at any zoom (the two registrations in §2/§3 exist precisely for these bugs).
4. depth field correctness: dark centre = far from any bank; foam only hugs true shorelines; caustics never over deep water.
5. Refraction: chromatic fringe visible at depth transitions, none in uniform depth; reflection: grazing → mirror at pitch ≥ 50°, with the warm sun glow sweeping when the map rotates; foam/glint stay additive on top of the sky mix.
6. Spread replay: sheets fill north→south in latitude order, interior-first with a visible lit front, several lobes merging; `getGrow()` ramps 0→1 smoothly; End-Tour restores `grow=1`, look, palette, dataset, camera exactly (no leaked overrides, button highlight = actual state).
7. Perf: polygons culled by real projected vertices (5–20 drawn close, hundreds at continent zoom); reprojection < ~65 ms worst case on a software rasteriser; one-off flood build < ~10 s; 60 fps on a real GPU.

## 7. PITFALLS ALREADY SOLVED (don't relearn)

- Morphological closing `buffer(±0.0030°, resolution=2)` (not res=1) to fuse ponds into sheets without jagged arcs; filter small holes manually.
- SDF seeded bank-only via `openEdges`; percentile reference, blur, per-feature texel caps for thousands of small sheets.
- WILD vertex cull after reprojection (kills pale ribbons at pitch/zoom).
- `zcSoft` + `fadeMid` compensation on the 0.028 refraction bend (kills rainbow mottling and far-edge confetti).
- Stencil parity + painted-this-frame bit (kills double-blend seams between overlapping sheets).
- Perspective-correct `v_uv` via custom `w` (kills pitched smearing); vertex-grown scissor.
- In the tour: force look presets per scene; sync UI button highlights from the same setter the tour calls; restore by name or by saved object if the look was custom.
```

Deliverables this time: `waterSurface.js` (single module, ES module, ~no deps), `build_floods.py`, the derived `pk_floods.geojson`, a wired demo page with palettes/looks/opacity/dataset switch + the tour scene, and a README documenting deviations and the API.
