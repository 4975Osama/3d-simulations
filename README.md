# Animated WebGL water surface — Pakistan / Indus basin rivers

An implementation of the animated WebGL water-surface fill spec, applied to the real
river network of Pakistan: the Indus and its tributaries, the big reservoirs, and the
braided reaches with their true islands.

Surface fill only — no particles, no flow arrows, no foam sprites, no UI inside the layer.

```
waterSurface.js                  ← the deliverable module (dependency-free ESM)
demo/index.html, demo/app.js     ← MapLibre GL demo harness (the UI lives here)
demo/tour.js                     ← guided 10-scene cinematic walkthrough (see §3)
demo/public/pk_rivers.geojson    ← 345 water polygons, 416 island holes (OSM derived)
demo/public/pk_floods.geojson    ← 2022 monsoon flood extents, 3,343 polygons (UNOSAT VIIRS)
demo/public/{land,provinces,places}.geojson   ← offline vector basemap
data/build_rivers.py             ← the river data pipeline (Overpass → GeoJSON)
data/build_floods.py             ← the flood data pipeline (UNOSAT/HDX shapefile → GeoJSON)
pakistan_rivers_water_surface.mp4 ← 13 s capture of the result
```

Run it:

```bash
python3 -m http.server 8080 --bind 0.0.0.0 --directory .    # from the repo root
# open http://localhost:8080/demo/index.html
```

### The portal (with YouTube video uploads)

`portal/` needs the small server in `server/`: it serves the portal and uploads the
Simex Videos / Hazard Calendars / General Videos pages to your YouTube channel, one
playlist per page. Google credentials live only in `server/.env`, never in the browser.

```bash
cd server
cp .env.example .env     # then fill it in — see the comments in that file
npm install
npm start                # open http://localhost:8080/portal/
```

A plain static server still runs the map, but the video pages will say the portal
server isn't running. The refresh token needs the full `youtube` scope, and YouTube
keeps API uploads private until your Cloud project passes its API audit.

---

## 1. The module

```js
import earcut from './vendor/earcut.js';
import water  from './waterSurface.js';

water.init(gl, canvas, { earcut, pixelRatio: devicePixelRatio });
water.setPolygons(featureCollection, {
  bearingByFeature:  (f) => f.properties.bearing,   // flow direction, degrees
  avgSpeedByFeature: (f) => f.properties.speed,     // mean surface speed, m/s
});
water.setPalette('dark');                            // terrain | satellite | dark | streets

// every animation frame
water.render(dt, map.getBearing(), speedMultiplier, (lon, lat) => map.project([lon, lat]));
```

`init / setPolygons / setPalette / render` are the four functions from the spec.
Extras: `invalidateProjection()`, `setRain(bool)`, `setPaused(bool)`, `setPixelRatio(r)`,
`setTime(t)`, `setOverlapDedupe(bool)`, `setLod(bool)`, `setLook(name|overrides)`,
`getLook()`, `setPerspective(bool)`, `setOpacity(v)` / `getOpacity()` (global water
opacity multiplier, 0–1, on top of the palette opacity), `setPitch(deg)` / `getPitch()`
(feeds the grazing-view reflection boost; or pass `map.getPitch()` as render()'s
optional 5th argument), `setGrow(t)` / `getGrow()` — a staged-inundation clock: polygons
whose properties carry a `reveal` delay in [0,1] fill from their interior out to their
mapped shoreline (with a lit front) while the clock passes their delay; untagged
polygons render exactly as before (default 1 = fully spread), `stats()`, `dispose()`.
`createWaterSurface(opts)` returns an independent instance if you need several layers.

The only dependency is a triangulator with the `earcut(coords, holes, dim)` signature —
injected via `init(gl, canvas, { earcut })` or read from `globalThis.earcut`.

### Built exactly as specified

* Transparent overlay `<canvas>` over the map canvas, `pointer-events: none`, one
  `webgl` context with `{ alpha, stencil, antialias, premultipliedAlpha, depth: false }`.
* Per polygon: earcut triangulation of the outer ring; interleaved
  `vec2 a_uv, vec2 a_pos` (stride 16, uv at 0, pos at 8); a grayscale
  `LUMINANCE / UNSIGNED_BYTE`, `LINEAR`, `CLAMP_TO_EDGE` distance-to-bank texture;
  and a second screen-space-only mesh (outer ring + every hole ring, each separately
  triangulated) used purely for stencil masking.
* Every frame, per polygon: stencil pass with colour writes off —
  `stencilFunc(ALWAYS, 0, 0xff)`, outer `INCR`, each hole `DECR`, then
  `stencilFunc(EQUAL, 1, …)` for the surface draw, blended `ONE / ONE_MINUS_SRC_ALPHA`
  with the shader emitting premultiplied `vec4(col * a, a)`.
* Uniforms per the table: `u_res`, `u_sun = (sin az, -cos az)` with
  `az = (235 - bearing)·π/180`, `u_time`, `u_rain`, palette uniforms, and per polygon
  `u_flow` (bbox-normalised unit flow vector), `u_scroll = 0.35 + avgSpeed·1.6`, `u_sdf`.
* Clock: `time += min(dt, 0.1) · (0.35 + 0.65 · speedMultiplier)`, only while unpaused.
* The spec's GLSL is the baseline for both shaders: `setLook('spec')` reproduces it
  exactly (every added uniform is neutral at 1.0 / ramp `[0.12, 0.75]` / detail 1 / 0.0).
  The default `realistic` look drives those same uniforms — see deviation 5.
* Projection is the caller's real `project()` per vertex — never an interpolated grid —
  and only re-runs when the camera actually moved (probe points + `invalidateProjection()`).
  The demo has a **"Coarse projection bug"** toggle that swaps in a 4×4 interpolated
  lon/lat→screen grid so you can see the exact failure mode the spec warns about:
  fine when zoomed out, sheared and sliver-ridden once zoomed in or tilted
  (`shots/qa-projection-exact.png` vs `shots/qa-projection-coarse.png`).

### Six things I had to add to make it hold up on real data

Each is a documented option; set it back to the spec value to get the literal behaviour.

1. **Horizon guard** (`filterMesh`). `map.project()` on a point behind the camera returns a
   mirrored / astronomically large screen position — a single such vertex drags a triangle
   across the entire viewport (measured: ±47,000,000 px on a pitched view of a 40 km reach).
   Because a valid map projection preserves triangle winding, any triangle whose screen
   winding flipped relative to its **geographic** winding has a vertex behind the camera;
   those, plus any triangle touching a vertex more than 3 viewport-widths out, are dropped
   for that frame via a filtered index buffer. Fully on-screen meshes skip the test.
   *(Winding must be computed per triangle from the source coordinates — earcut normalises
   the winding of its own output, so the ring's orientation tells you nothing.)*
2. **Higher SDF resolution** (`sdfMaxSide: 640`, spec says ~224). A 224 px cap puts a 300 m
   braided channel on ~3 texels, and the whole river then renders as one flat foam band —
   at 640 the depth ramp survives. The quantised raster also gets a separable 3×3 blur,
   because `LINEAR` sampling of a coarse field under a steep depth gamma otherwise shows
   single texels as faceted diamonds along the banks. `sdfMetersPerTexel` (default 0 = off) additionally caps
   the *ground* resolution if you'd rather trade sharpness for memory on huge features —
   and a feature-level `properties.sdfMetersPerTexel` override does the same per polygon
   (the flood dataset uses 250 m/texel so 3,343 ponds stay within a few MB of textures;
   the adaptive path floors at a 24-texel short side). The
   distance transform is an exact separable Felzenszwalb–Huttenlocher EDT with per-axis texel
   sizes, so the metric stays isotropic on the ground even for extreme-aspect reaches.
3. **Depth reference percentile** (`sdfPercentile: 0.9`). Dividing by the true `maxDist`
   means one wide pool defines "deep" for the whole feature and every side channel collapses
   into foam. A high percentile keeps the intended "interior saturates early" behaviour.
   `sdfPercentile: 1` is the literal formula.
4. **Open edges** (`properties.openEdges` / `openEdgesByFeature`). A long river must be cut
   into several polygons, and the cuts are not banks — left alone they produce a bright foam
   stripe straight across the river at every join. Each feature can list its artificial cut
   segments; the distance field is then seeded from real banks only. Omit it and nothing
   changes.
5. **Look uniforms** (`setLook`, default `'realistic'`). On real geometry three terms of the
   spec shader saturate wherever the distance field is shallow over a wide area — the bank
   foam band, the shallow caustics and the shallow end of the colour ramp — and a zoomed-in
   braided reach turns into a white sheet. Rather than editing the GLSL, every one of those
   terms is now scaled by a uniform, plus a few additions that make moving water read as
   water: zoom-aware ripple detail (`u_detail`, the wave field keeps a constant apparent
   scale and physical speed as you zoom), an organic shore wobble, wave-face shading, a
   broad specular lobe, and a footprint fade (`fwidth`) that stops fine detail from
   aliasing into a bright haze in the distance. **Refraction** (`u_refract`): the wave
   slope bends the view ray and the depth field is re-sampled through *three
   chromatically dispersed taps* (1.15 / 1.0 / 0.85 — red bends most, blue least), so the
   bed ramp wobbles through passing waves and depth transitions pick up a subtle
   red/blue fringe; the bend follows the zoom-compacted ramp (`zcSoft`) so the fringe
   stays subtle at high zoom instead of blowing out into rainbow mottling, and the twin
   caustic fields are warped by ±`refr*8` so they dance with the waves. **Reflection**
   (`u_reflect` × palette `refl`): a Fresnel-weighted procedural sky — physical 4% base
   plus a wave-facet curve, a two-stop horizon/zenith gradient (`skyH`/`skyZ` per map
   style: day blue on terrain/satellite/streets, dim night sky on dark), a warm glow
   around the sun's mirror position, and a grazing boost (`u_pitch` × `v_scr.y`, fed by
   `setPitch` or render's 5th arg) so tilted views mirror much more sky towards the
   horizon while a top-down camera keeps almost none. Composite is
   `mix(body, sky, fresnel)` with foam and sun glint additive on top. Presets:

   | look | what it is |
   |---|---|
   | `spec` | the original shader, bit for bit (refraction / reflection off) |
   | `realistic` *(default)* | full reference refraction (1.0 × the 0.028 bend) + full palette sky reflection |
   | `glassy` | gentler refraction (0.6×), strongest mirror (1.15×) |

   `setLook({ foam: 0.5, ramp: [0.04, 0.6], … })` overrides individual fields.
6. **Perspective-correct `v_uv`** (`setPerspective(false)` to disable). The mesh is drawn as
   flat screen-space triangles, so the depth texture would interpolate affinely: exact
   top-down, badly wrong under pitch, where near-camera fragments smear the surface into
   long streaks and far ones read as bank. For a planar map the screen→ground homography's
   denominator is an affine function of the screen position, so three probes per camera move
   recover it (validated against MapLibre's own `projMatrix` to four digits) and the vertex
   shader feeds it back as `gl_Position.w`. Neutral `(1, 0, 0)` whenever the camera is
   effectively top-down. Two related fixes ride along: the scissor rect is grown to the
   *reprojected vertices* rather than 9 bbox probes (a tilted reach was being cut off along
   a hard horizontal line), and a polygon is culled after reprojection when none of its real
   vertices land near the viewport — distant reaches whose clamped meshes used to paint pale
   slabs of water over dry land. The wild-vertex limit in the horizon guard is 3 viewport
   widths, not 8.

`sdfLocal` (default 0) is available but off: it normalises depth by the *local* channel
width instead of one divisor per polygon. It gives narrow side channels a full depth range,
at the cost of making wide braid plains read shallow, so the polygon-wide reference stays
the default.

Two performance behaviours worth knowing: polygons are **LOD-simplified** (Douglas–Peucker
chain, chosen for sub-pixel error) and viewport-culled through 9 projected probe points
before their full ring is touched — at basin zoom that's 14 k `project()` calls instead of
60 k. And a "painted" stencil bit (bit 4) makes each screen pixel paint at most once per
frame, so overlapping polygons at confluences can't double-blend into dark seams
(`setOverlapDedupe(false)` to disable).

---

## 2. The Pakistan data

`data/build_rivers.py`, everything from OpenStreetMap via the Overpass API (ODbL):

* **Centrelines** for the Indus (~2,600 km of mapped ways across its name variants),
  Jhelum, Chenab, Ravi, Sutlej, Panjnad, Kabul, Swat, Kunhar, Kurram, Soan, Haro, and the
  northern rivers Hunza, Gilgit, Shyok, Shigar, Astore. Canals are filtered out.
* Each river is buffered **once** into a continuous, width-varying channel (the Indus widens
  from ~380 m in the north to ~2.2 km downstream), then **tiled** into ~40 km reaches by
  exact perpendicular cuts via `polygonize`. Tiling instead of buffering overlapping chunks
  is what removes double-blended overlaps and caps poking through the neighbour's bank at
  bends; the cut lines are exported as `openEdges`.
* **Real OSM riverbank multipolygons** where they exist — the braided Indus at Sukkur and
  the Ghazi reach below Tarbela, the latter with **114 genuine island rings** — plus the
  Tarbela, Mangla, Chashma reservoirs and Manchar Lake. Buffered reaches are differenced
  against these so the real geometry always wins.
* Islands are carved into wide reaches; per-feature `bearing` (flow direction from the
  centreline tangent) and `speed` (m/s, 2.5 in the mountains down to 0.12 in reservoirs)
  drive `u_flow` and `u_scroll`.

**345 features, 60 k outer vertices, 416 holes, 2.1 MB.** Largest ring: 8,972 vertices
(Mangla). Concave, multi-hole, high-vertex — the cases the spec asks to hold up under.

`data/build_floods.py` builds the **2022 monsoon flood extents** (UNOSAT code
FL20220808PAK via HDX, CC BY-SA): the cumulative VIIRS-NOAA satellite water mask for
01–31 August 2022, ~91,400 km² of detected surface water. The raw shapefile is one
multipart polygon of ~8,400 VIIRS ponds, so the pipeline fuses ponds closer than ~330 m
into continuous flood sheets (morphological closing with round joins), smooths the
pixel-stair coastlines, explodes, and drops specks below 0.2 km². Every feature is tagged
`speed: 0.15` (calm sheet water) and `sdfMetersPerTexel: 250`, which caps that polygon's
depth-raster ground resolution — a per-feature hint `waterSurface.js` honours so
thousands of small ponds don't each claim a full 640-side depth texture. The result is
**3,343 polygons + 3,313 holes, 83.5 k vertices, 3.5 MB** — the Indus corridor lake chain
from Kashmor to the sea, the Kachhi plain lagoon, Manchar/Hamal overflow, and the
DG Khan / Rajanpur pond constellations, all animated and reflective like the rivers.

## 3. The demo harness

MapLibre GL 4.7 with a **fully local vector basemap** (Natural Earth land, provinces, city
markers as DOM elements so no glyph server is needed) — it works with no network at all.
`satellite` and `streets` additionally pull Esri World Imagery / OSM raster tiles on top when
online, with the vector base still underneath as fallback. Controls: palette switch, play /
pause, speed, rain, tilt, 3D terrain (AWS terrarium DEM), orbit, eleven fly-to hotspots
(incl. the Sindh floodplain), a live
HUD (fps, polygons drawn, reprojection ms), a **water bodies** switch
(rivers / floods 2022 / both — rebuilding synchronously, ~2 s for floods and ~10 s for
both on a software rasteriser), a **water look** switch
(realistic / glassy / spec), a **water opacity** slider (0–100%, wired to
`setOpacity`) and the coarse-projection diagnostic.

**Guided cinematic tour** (`demo/tour.js`, button: *🎬 Cinematic tour — start*). A ten-scene
walkthrough that explains every feature one by one with a caption panel (scene counter,
progress dots, ‹ Prev / Next ›, End tour, ←/→/Esc keyboard shortcuts, map input quieted while
it runs): the nationwide overview · real OSM polygons and braided islands · the
distance-to-bank texture ("why deep water reads dark") · bank ballistics and flow · foam and
caustics · refraction (temporarily boosted ×3 so the chromatic-bent view ray is unmistakable)
· reflection (pitched, slowly orbiting Mangla under satellite — the glassy look) ·
**"Flood 2022 — how the water spread"**, a drone-view replay of the inundation (dataset
switch to the UNOSAT flood mask, then a 19 s `setGrow` clock drives every sheet
north → south while the camera dives from KP's flash-flood valley to Sindh's capped
floodplain sea; each polygon fills from its interior out to its mapped shoreline with a
luminous lip riding the front) · the Sindh floodplain · and a dark, orbiting finale.
Switching datasets is
part of the narration: the floods scene announces the one-off rebuild before triggering it.
Ending anywhere restores every user setting exactly — basemap, palette, look (including the
button highlight), opacity, water bodies, camera, orbit and terrain — and re-enables map
input. Also scriptable: `window.tour.play(i) / next() / prev() / stop()`.

Verified in headless Chrome (SwiftShader) at zoom 5–15, pitch 0–62°, with rotation and 3D
terrain: no GL errors, 311/345 polygons drawn at basin zoom, reprojection 2–64 ms per camera
move, `setPolygons` ~4 s for the full basin on a software rasteriser (triangulation + 345
distance fields at 640 px; roughly a third of that on a real GPU machine). Close-range views
draw 5–20 polygons now that off-screen reaches are culled on their real vertices rather than
on bbox probes.
