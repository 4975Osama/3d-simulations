#!/usr/bin/env python3
"""Build a Pakistan 2022 flood-extent GeoJSON for the WebGL water surface demo.

Source: UNOSAT / UNITAR "Satellite detected water extents between 01 and 29
August 2022 over Pakistan" (UNOSAT code FL20220808PAK) -- cumulative VIIRS
(NOAA) flood-water mask, ~86,640 km2, WGS84. Downloaded from the Humanitarian
Data Exchange (HDX). License: CC BY-SA.

The shapefile is one giant multipart POLYGON (VIIRS pixel mask). This script:
  * fixes invalid rings (buffer 0),
  * simplifies the stair-step coastlines (Douglas-Peucker ~85 m),
  * explodes the multipolygon and drops Landsat-pixel dust (< 0.05 km2),
  * tags every feature as calm flood water (speed 0.15 -> slow scroll), and
  * writes demo/public/pk_floods.geojson, rounded to 5 dp (~1 m).
"""
import io, json, math, os, urllib.request, zipfile

import shapefile  # pyshp
from shapely.geometry import shape, mapping, box, Polygon
from shapely.ops import unary_union

D = os.path.dirname(os.path.abspath(__file__))
ZIP_PATH = os.path.join(D, "viirs_2022_floodextent_pak.zip")
URL = ("https://data.humdata.org/dataset/f685e623-a539-4af0-92ff-19b737ec95b3/"
       "resource/fa89ec39-8dd0-4abe-b97e-0a3d9e9627a5/download/"
       "viirs_20220701_20220831_floodextent_pak.zip")
OUT = os.path.join(D, "..", "demo", "public", "pk_floods.geojson")

PK_BBOX = box(60.4, 23.2, 77.8, 37.2)     # generous Pakistan window
SIMPLIFY = 0.0010                          # ~110 m at these latitudes
CLOSE = 0.0030                             # ~330 m morphological closing
MIN_AREA_KM2 = 0.2                         # drop surviving specks
MIN_HOLE_KM2 = 0.1                         # and dust-sized holes
KM2_PER_DEG2 = (111.32 * 110.54) * math.cos(math.radians(30.8))

# --------------------------------------------------------------------- fetch
if not os.path.exists(ZIP_PATH):
    print("downloading", URL)
    urllib.request.urlretrieve(URL, ZIP_PATH)

z = zipfile.ZipFile(ZIP_PATH)
name = next(n for n in z.namelist() if n.lower().endswith(".shp"))
base = name[:-4]
rd = shapefile.Reader(
    shp=io.BytesIO(z.read(base + ".shp")),
    dbf=io.BytesIO(z.read(base + ".dbf")),
    shx=io.BytesIO(z.read(base + ".shx")),
)
meta = {f[0]: v for f, v in zip([f[0] for f in rd.fields[1:]], rd.record(0))}
print("source record:", json.dumps({k: str(v) for k, v in meta.items()}, indent=1))

# ------------------------------------------------------------------ geometry
geom = unary_union([shape(s.__geo_interface__) for s in rd.iterShapes()])
geom = geom.buffer(0)                       # repair self-intersections
# fuse ponds separated by < ~CLOSE metres of land into continuous flood
# sheets: the raw VIIRS mask is ~8,400 separate ponds, which no per-polygon
# renderer (SDF texture + stencil pass each) can afford; closing keeps the
# visible water coverage but merges it into its connected regions first
geom = geom.buffer(CLOSE, resolution=2).buffer(-CLOSE, resolution=2)
geom = geom.simplify(SIMPLIFY, preserve_topology=True)
geom = geom.intersection(PK_BBOX)

polys = list(getattr(geom, "geoms", [geom]))
kept, dropped, raw_pts, out_pts = 0, 0, 0, 0
features = []
for g in sorted(polys, key=lambda p: -p.area):
    if g.area * KM2_PER_DEG2 < MIN_AREA_KM2:
        dropped += 1
        continue
    g = g.buffer(0)
    if g.is_empty or not g.is_valid:
        continue
    # drop dust-sized interior holes (keep genuine dry hamlets inside sheets)
    holes = [r for r in g.interiors if Polygon(r).area * KM2_PER_DEG2 >= MIN_HOLE_KM2]
    if len(holes) != len(g.interiors):
        g = Polygon(g.exterior.coords, [r.coords for r in holes])
    ext_pts = len(g.exterior.coords)
    raw_pts += ext_pts
    kept += 1
    out_pts += ext_pts
    features.append({
        "type": "Feature",
        "properties": {
            "name": "Monsoon flood extent",
            "kind": "flood",
            "event": "Pakistan monsoon floods, 01-29 Aug 2022",
            "sensor": meta.get("Sensor_ID", "VIIRS-NOAA"),
            "source": "UNOSAT FL20220808PAK (HDX, CC BY-SA)",
            "speed": 0.15,          # standing / slow sheet water -> gentle scroll
            "area_km2": round(g.area * KM2_PER_DEG2, 1),
            # per-feature hint for waterSurface.js: cap the depth raster's
            # ground resolution (m/texel) -- thousands of small ponds must not
            # each claim a 640-side texture
            "sdfMetersPerTexel": 250,
        },
        "geometry": mapping(g),
    })

def round_coords(obj, nd=5):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(c, nd) for c in obj[:2]]
        return [round_coords(c, nd) for c in obj]
    return obj

for f in features:
    f["geometry"]["coordinates"] = round_coords(f["geometry"]["coordinates"])

fc = {"type": "FeatureCollection",
      "metadata": {
          "title": "Pakistan monsoon flood extents, August 2022 (UNOSAT VIIRS)",
          "sensor": "VIIRS-NOAA", "window": "2022-08-01..2022-08-31",
          "source": "UNOSAT FL20220808PAK via HDX", "license": "CC BY-SA"},
      "features": features}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(fc, f, separators=(",", ":"))

size = os.path.getsize(OUT) / 1e6
total_km2 = sum(f["properties"]["area_km2"] for f in features)
holes = sum(len(g["geometry"]["coordinates"]) - 1 for g in features)
print(f"kept {kept} polygons (+{holes} holes), dropped {dropped} dust polygons")
print(f"total water {total_km2:.0f} km2, vertices {out_pts:,}")
print(f"wrote {OUT} ({size:.1f} MB)")
