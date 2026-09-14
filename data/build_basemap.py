#!/usr/bin/env python3
"""Offline vector basemap for the demo (Natural Earth, public domain).

Downloads once into this folder, then writes trimmed/simplified GeoJSON into
../demo/public/. Re-run only if you want to rebuild the basemap.
"""
import json, os, urllib.request
from shapely.geometry import shape, mapping, box

D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, "..", "demo", "public")
BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
REG = box(58.0, 21.0, 82.0, 39.5)          # Pakistan + neighbours

def grab(name):
    p = os.path.join(D, name + ".geojson")
    if not os.path.exists(p):
        urllib.request.urlretrieve(f"{BASE}/{name}.geojson", p)
    return json.load(open(p))

feats = []
for f in grab("ne_50m_admin_0_countries")["features"]:
    nm = f["properties"].get("NAME")
    g = shape(f["geometry"])
    if not g.intersects(REG):
        continue
    g = g.intersection(REG).simplify(0.01, preserve_topology=True)
    if not g.is_empty:
        feats.append({"type": "Feature", "properties": {"name": nm, "pk": int(nm == "Pakistan")},
                      "geometry": mapping(g)})
json.dump({"type": "FeatureCollection", "features": feats},
          open(f"{OUT}/land.geojson", "w"), separators=(",", ":"))

pf = [{"type": "Feature", "properties": {"name": f["properties"].get("name")},
       "geometry": mapping(shape(f["geometry"]).simplify(0.008, preserve_topology=True))}
      for f in grab("ne_10m_admin_1_states_provinces")["features"]
      if (f["properties"].get("admin") or "") == "Pakistan"]
json.dump({"type": "FeatureCollection", "features": pf},
          open(f"{OUT}/provinces.geojson", "w"), separators=(",", ":"))

cf = []
for f in grab("ne_10m_populated_places_simple")["features"]:
    p, g = f["properties"], shape(f["geometry"])
    pop = p.get("pop_max") or 0
    if REG.contains(g) and ((p.get("adm0name") == "Pakistan" and pop > 150000) or pop > 2500000):
        cf.append({"type": "Feature", "geometry": mapping(g),
                   "properties": {"name": p.get("name"), "pop": pop, "country": p.get("adm0name"),
                                  "cls": 0 if pop > 3e6 else (1 if pop > 8e5 else 2)}})
cf.sort(key=lambda f: -f["properties"]["pop"])
json.dump({"type": "FeatureCollection", "features": cf},
          open(f"{OUT}/places.geojson", "w"), separators=(",", ":"))
print("basemap written:", len(feats), "countries,", len(pf), "provinces,", len(cf), "places")
