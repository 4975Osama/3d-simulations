#!/usr/bin/env python3
"""Build a Pakistan river-network water-body GeoJSON for the WebGL water surface demo.

Sources: OpenStreetMap via Overpass (river centerlines, real riverbank multipolygons,
reservoir multipolygons).  Centerlines are buffered into realistic channel polygons,
cut into reaches, and given islands (interior rings) on the wide braided stretches.
"""
import json, math, re, os
from collections import defaultdict
from shapely.geometry import LineString, Polygon, MultiPolygon, Point, mapping, shape
from shapely.ops import linemerge, unary_union, transform, polygonize

D = os.path.dirname(os.path.abspath(__file__))
LAT0 = 30.5
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 110540.0

to_m = lambda g: transform(lambda x, y, z=None: (x * MX, y * MY), g)
to_deg = lambda g: transform(lambda x, y, z=None: (x / MX, y / MY), g)

# ---------------------------------------------------------------- name mapping
NAME_MAP = [
    (r"سندھ|سنڌو|Indus|Sindhu", "Indus"),
    (r"جہلم|Jhelum", "Jhelum"),
    (r"چناب|Chenab", "Chenab"),
    (r"راوی|Ravi", "Ravi"),
    (r"ستلج|Sutlej|Satluj", "Sutlej"),
    (r"کابل|Kabul", "Kabul"),
    (r"سوات|Swat", "Swat"),
    (r"پنجند|Panjnad", "Panjnad"),
    (r"Kunhar|کنہار", "Kunhar"),
    (r"Gilgit", "Gilgit"),
    (r"Hunza", "Hunza"),
    (r"Shyok", "Shyok"),
    (r"Shigar", "Shigar"),
    (r"Astore", "Astore"),
    (r"Kurram", "Kurram"),
    (r"Soan", "Soan"),
    (r"Haro", "Haro"),
    (r"Poonch", "Poonch"),
    (r"Panjkora", "Panjkora"),
    (r"Bara", "Bara"),
    (r"Gomal", "Gomal"),
    (r"Zhob", "Zhob"),
    (r"Hub", "Hub"),
    (r"Dasht", "Dasht"),
]
CANAL = re.compile(r"کینال|نہر|فیڈر|لنک|Canal|Feeder|Link|Branch|برانچ")

# half-width (m) of the wetted channel, and mean surface current (m/s)
PROFILE = {
    "Indus":   dict(hw=520, spd=1.55),
    "Chenab":  dict(hw=330, spd=1.35),
    "Jhelum":  dict(hw=290, spd=1.30),
    "Ravi":    dict(hw=190, spd=1.05),
    "Sutlej":  dict(hw=250, spd=1.10),
    "Panjnad": dict(hw=560, spd=1.40),
    "Kabul":   dict(hw=240, spd=1.80),
    "Swat":    dict(hw=120, spd=1.90),
    "Kunhar":  dict(hw=55,  spd=2.30),
    "Gilgit":  dict(hw=85,  spd=2.40),
    "Hunza":   dict(hw=80,  spd=2.50),
    "Shyok":   dict(hw=140, spd=2.10),
    "Shigar":  dict(hw=130, spd=2.00),
    "Astore":  dict(hw=45,  spd=2.40),
    "Kurram":  dict(hw=90,  spd=1.60),
    "Soan":    dict(hw=70,  spd=1.20),
    "Haro":    dict(hw=60,  spd=1.30),
    "Poonch":  dict(hw=70,  spd=1.90),
    "Panjkora":dict(hw=65,  spd=2.00),
    "Bara":    dict(hw=50,  spd=1.40),
    "Gomal":   dict(hw=70,  spd=1.00),
    "Zhob":    dict(hw=60,  spd=0.90),
    "Hub":     dict(hw=60,  spd=0.80),
    "Dasht":   dict(hw=70,  spd=0.70),
}


def canon(tags):
    blob = " ".join(str(tags.get(k, "")) for k in ("name", "name:en", "name:ur", "alt_name"))
    if CANAL.search(blob):
        return None
    for pat, nm in NAME_MAP:
        if re.search(pat, blob):
            return nm
    return None


def load(fn):
    p = os.path.join(D, fn)
    return json.load(open(p))["elements"] if os.path.exists(p) else []


# ------------------------------------------------------- 1. gather centerlines
lines = defaultdict(list)
for fn in ("rivers_raw.json", "rivers_urdu.json", "rivers_rel.json"):
    for el in load(fn):
        if el["type"] == "way" and el.get("geometry"):
            nm = canon(el.get("tags", {}))
            if nm and len(el["geometry"]) > 1:
                lines[nm].append(LineString([(p["lon"], p["lat"]) for p in el["geometry"]]))
        elif el["type"] == "relation":
            nm = canon(el.get("tags", {}))
            if not nm:
                continue
            for m in el.get("members", []):
                if m.get("type") == "way" and m.get("geometry") and len(m["geometry"]) > 1:
                    lines[nm].append(LineString([(p["lon"], p["lat"]) for p in m["geometry"]]))

print("centerline rivers:", {k: len(v) for k, v in sorted(lines.items())})


def bearing(a, b):
    """geographic bearing deg (0=N, 90=E) from lon/lat a to b"""
    dx = (b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = b[1] - a[1]
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


def cut(line_m, step, overlap):
    """split a metric LineString into chunks of `step` m with `overlap` m of overlap"""
    L = line_m.length
    if L < step * 1.4:
        return [line_m]
    out, s = [], 0.0
    while s < L - 1:
        e = min(s + step, L)
        pts = [line_m.interpolate(d) for d in
               [s] + [s + i * 250 for i in range(1, int((e - s) / 250) + 1)] + [e]]
        seen, cl = set(), []
        for p in pts:
            k = (round(p.x, 1), round(p.y, 1))
            if k not in seen:
                seen.add(k); cl.append((p.x, p.y))
        if len(cl) > 1:
            out.append(LineString(cl))
        s = e - overlap
        if L - s < step * 0.35:
            break
    return out


def islands(poly_m, line_m, hw, seed):
    line_m = line_m.intersection(poly_m.buffer(hw * 0.1))
    if line_m.geom_type == 'MultiLineString':
        line_m = max(line_m.geoms, key=lambda g: g.length)
    if line_m.is_empty or line_m.geom_type != 'LineString' or line_m.length < 2000:
        return poly_m
    """carve deterministic elliptical bars/islands out of a wide reach"""
    if hw < 210:
        return poly_m
    rnd = seed
    def nxt():
        nonlocal rnd
        rnd = (1103515245 * rnd + 12345) % 2147483648
        return rnd / 2147483648
    n = max(1, int(line_m.length / 9000))
    cuts = []
    core = poly_m.buffer(-hw * 0.42)
    for i in range(n):
        t = (i + 0.35 + 0.3 * nxt()) / n
        c = line_m.interpolate(t, normalized=True)
        d = 0.0006 * line_m.length
        a = line_m.interpolate(max(0, t * line_m.length - d))
        b = line_m.interpolate(min(line_m.length, t * line_m.length + d))
        ang = math.atan2(b.y - a.y, b.x - a.x)
        lon_r = hw * (1.6 + 2.4 * nxt())          # along-stream half length
        lat_r = hw * (0.16 + 0.30 * nxt())        # cross-stream half width
        off = (nxt() - 0.5) * hw * 0.7
        cx, cy = c.x - math.sin(ang) * off, c.y + math.cos(ang) * off
        el = Point(0, 0).buffer(1.0, 48)
        el = transform(lambda x, y, z=None: (x * lon_r, y * lat_r), el)
        el = transform(lambda x, y, z=None: (x * math.cos(ang) - y * math.sin(ang) + cx,
                                             x * math.sin(ang) + y * math.cos(ang) + cy), el)
        if core.contains(el):
            cuts.append(el)
    if not cuts:
        return poly_m
    res = poly_m.difference(unary_union(cuts))
    return res if res.geom_type == "Polygon" and res.is_valid else poly_m


features = []
fid = 0


def piece_bearing(lm, geom):
    """flow bearing (deg) from the centreline tangent nearest this piece"""
    t = lm.project(geom.centroid)
    a = lm.interpolate(max(0.0, t - 1500))
    b = lm.interpolate(min(lm.length, t + 1500))
    ca, cb = to_deg(a).coords[0], to_deg(b).coords[0]
    return round(bearing(ca, cb), 1)


def build_reaches(real_union):
  """One buffered polygon per river, tiled into reaches by exact perpendicular
  cuts. Tiling (rather than buffering overlapping chunks) means adjacent reaches
  share an edge exactly: no double-blended overlaps, no caps poking out through
  the neighbour's bank at bends."""
  global fid
  for nm, segs in sorted(lines.items()):
    prof = PROFILE.get(nm, dict(hw=80, spd=1.2))
    u = unary_union([s for s in segs if s.length > 0])
    merged = linemerge(u) if u.geom_type != "LineString" else u
    parts = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
    parts = [p for p in parts if to_m(p).length > 4000]
    ci = 0
    for part in parts:
        lm = to_m(part).simplify(45)
        if lm.length < 3500:
            continue

        def hw_at(d):
            """half-width (m) at distance d along this centreline"""
            lat = to_deg(lm.interpolate(d)).coords[0][1]
            if nm == "Indus":
                return 190 + 900 * max(0.0, min(1.0, (35.6 - lat) / 10.0)) ** 1.5
            return prof["hw"]

        # 1. one continuous, width-varying channel polygon
        STEP = 4000.0
        blobs = []
        d = 0.0
        while d < lm.length:
            e = min(d + STEP, lm.length)
            sub = LineString([lm.interpolate(x) for x in
                              [d] + [d + i * 500 for i in range(1, int((e - d) / 500) + 1)] + [e]])
            if sub.length > 1:
                blobs.append(sub.buffer(hw_at((d + e) / 2), resolution=6, join_style=1, cap_style=1))
            d = e
        chan = unary_union(blobs)
        if chan.geom_type == "MultiPolygon":
            chan = max(chan.geoms, key=lambda g: g.area)
        chan = chan.simplify(20)

        # 2. perpendicular cut lines every ~REACH_LEN metres
        REACH_LEN = 40000.0
        cutters = []
        d = REACH_LEN
        while d < lm.length - REACH_LEN * 0.4:
            c = lm.interpolate(d)
            a = lm.interpolate(max(0, d - 200)); b = lm.interpolate(min(lm.length, d + 200))
            vx, vy = b.x - a.x, b.y - a.y
            vl = math.hypot(vx, vy) or 1.0
            r = hw_at(d) * 4
            nx, ny = -vy / vl * r, vx / vl * r
            cutters.append(LineString([(c.x + nx, c.y + ny), (c.x - nx, c.y - ny)]))
            d += REACH_LEN

        # 3. tile the channel with those cuts
        if cutters:
            net = unary_union([chan.boundary] + cutters)
            pieces = [g for g in polygonize(net) if g.representative_point().within(chan)]
        else:
            pieces = [chan]
        pieces = [g for g in pieces if g.area > 2.0e5]
        pieces.sort(key=lambda g: lm.project(g.centroid))

        for piece in pieces:
            hw = hw_at(lm.project(piece.centroid))
            spd = prof["spd"] * (1.0 + 0.18 * math.sin(ci * 1.7))
            brg = piece_bearing(lm, piece)

            # cut edges bounding this piece are artificial, not banks
            caps = []
            for cut in cutters:
                inter = piece.boundary.intersection(cut.buffer(1.0))
                if inter.is_empty or inter.length < hw * 0.5:
                    continue
                x0, y0, x1, y1 = inter.bounds
                a = to_deg(Point(x0, y0)).coords[0]
                b = to_deg(Point(x1, y1)).coords[0]
                caps.append([[round(a[0], 6), round(a[1], 6)], [round(b[0], 6), round(b[1], 6)]])

            # 1.5 m of overlap closes the antialiased hairline between tiles;
            # the renderer's paint-once stencil keeps it from double-blending
            poly = islands(piece.buffer(1.5), lm, hw, 7919 + fid * 131)
            g = to_deg(poly).simplify(1.2e-4, preserve_topology=True)
            if g.is_empty or g.area <= 0 or g.geom_type != "Polygon":
                continue
            outs = [g]
            if real_union is not None and g.intersects(real_union):
                diff = g.difference(real_union)
                if diff.is_empty:
                    ci += 1
                    continue
                outs = [q for q in (diff.geoms if diff.geom_type == "MultiPolygon" else [diff])
                        if q.geom_type == "Polygon" and to_m(q).area > 3.0e5]
            for q in outs:
                features.append({
                    "type": "Feature", "id": fid,
                    "properties": {
                        "name": f"{nm} River", "river": nm, "kind": "reach", "reach": ci,
                        "bearing": brg, "speed": round(spd, 2), "width_m": round(hw * 2),
                        "openEdges": caps,
                    },
                    "geometry": mapping(q),
                })
                fid += 1
            ci += 1



# ------------------------------------- 2. real OSM riverbank / reservoir polygons
def rings_from_relation(el):
    outers, inners = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or not m.get("geometry"):
            continue
        cs = [(p["lon"], p["lat"]) for p in m["geometry"]]
        (outers if m.get("role") != "inner" else inners).append(cs)

    def close(chains):
        """stitch open ways into closed rings"""
        chains = [list(c) for c in chains]
        rings, used = [], [False] * len(chains)
        for i, c in enumerate(chains):
            if used[i]:
                continue
            used[i] = True; cur = c[:]
            changed = True
            while cur[0] != cur[-1] and changed:
                changed = False
                for j, o in enumerate(chains):
                    if used[j]:
                        continue
                    if o[0] == cur[-1]:
                        cur += o[1:]; used[j] = True; changed = True
                    elif o[-1] == cur[-1]:
                        cur += o[::-1][1:]; used[j] = True; changed = True
            if len(cur) > 3:
                if cur[0] != cur[-1]:
                    cur.append(cur[0])
                rings.append(cur)
        return rings
    return close(outers), close(inners)


def polys_from_element(el):
    out = []
    if el["type"] == "way" and el.get("geometry"):
        cs = [(p["lon"], p["lat"]) for p in el["geometry"]]
        if len(cs) > 3:
            if cs[0] != cs[-1]:
                cs.append(cs[0])
            pg = Polygon(cs)
            if not pg.is_valid:
                pg = pg.buffer(0)
            if not pg.is_empty:
                out.append(pg)
    else:
        outers, inners = rings_from_relation(el)
        for o in outers:
            try:
                po = Polygon(o)
            except Exception:
                continue
            if not po.is_valid:
                po = po.buffer(0)
            if po.is_empty:
                continue
            hs = []
            for i in inners:
                try:
                    pi = Polygon(i)
                except Exception:
                    continue
                if pi.is_valid and po.contains(pi.representative_point()):
                    hs.append(i)
            try:
                pp = Polygon(o, hs)
                pp = pp if pp.is_valid else pp.buffer(0)
            except Exception:
                pp = po
            if not pp.is_empty:
                out.append(pp)
    return out


SEEN = set()
LAKE_NAMES = {"تربیلا جھیل": "Tarbela Reservoir", "منگلا آبی ذخیرہ": "Mangla Reservoir",
              "Mangla Reservoir Summer": "Mangla Reservoir", "Lake Manchar": "Manchar Lake"}


def indus_bearing(g):
    x0, y0, x1, y1 = g.bounds
    return round(bearing((x0, y1), (x1, y0)), 1) if (x1 - x0) > (y1 - y0) else 190.0


def add_real(fn, kind, namer, spd, brg, min_area_m2):
    global fid
    n = 0
    for el in load(fn):
        tags = el.get("tags", {})
        for pg in polys_from_element(el):
            cands = list(pg.geoms) if pg.geom_type == "MultiPolygon" else [pg]
            for g in cands:
                am = to_m(g).area
                if am < min_area_m2:
                    continue
                key = (round(g.centroid.x, 4), round(g.centroid.y, 4), round(am / 1e4))
                if key in SEEN:
                    continue
                SEEN.add(key)
                gs = g.simplify(1.0e-4, preserve_topology=True)
                if gs.is_empty or gs.geom_type != "Polygon":
                    continue
                gs = Polygon(gs.exterior, [r for r in gs.interiors if Polygon(r).area > 1e-8])
                features.append({
                    "type": "Feature", "id": fid,
                    "properties": {
                        "name": namer(tags), "river": namer(tags), "kind": kind,
                        "bearing": brg(g), "speed": spd(am), "width_m": 0,
                        "islands": len(gs.interiors),
                    },
                    "geometry": mapping(gs),
                })
                fid += 1; n += 1
    print(f"{fn}: +{n} real polygons")


add_real("lakes.json", "reservoir",
         lambda t: LAKE_NAMES.get(t.get("name", ""), t.get("name:en") or t.get("name") or "Reservoir"),
         lambda a: 0.12, lambda g: 200.0, 6.0e6)

add_real("water_poly.json", "riverbank",
         lambda t: "Indus River" if re.search(r"سندھ|Indus", " ".join(map(str, t.values()))) else "Indus floodplain",
         lambda a: 1.25, indus_bearing, 4.0e5)

REAL_UNION = unary_union([shape(f["geometry"]) for f in features if f["properties"]["kind"] in ("riverbank", "reservoir")])
REAL_UNION = REAL_UNION.buffer(0)
build_reaches(REAL_UNION)
print("buffered reaches:", sum(1 for f in features if f["properties"]["kind"] == "reach"))

# ------------------------------------------------------------------- 3. write
fc = {"type": "FeatureCollection",
      "properties": {"source": "OpenStreetMap contributors (ODbL) — via Overpass API"},
      "features": features}
out = os.path.join(D, "..", "demo", "public", "pk_rivers.geojson")
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(fc, open(out, "w"), separators=(",", ":"))

nv = sum(len(f["geometry"]["coordinates"][0]) for f in features)
nh = sum(len(f["geometry"]["coordinates"]) - 1 for f in features)
print(f"\nwrote {len(features)} features, {nv} outer verts, {nh} holes -> {os.path.getsize(out)/1e6:.2f} MB")
mx = max(features, key=lambda f: len(f["geometry"]["coordinates"][0]))
print("max ring:", len(mx["geometry"]["coordinates"][0]), "verts —", mx["properties"]["name"])
