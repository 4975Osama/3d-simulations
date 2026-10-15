#!/usr/bin/env python3
"""Convert the 2026 river flood extent shapefiles to portal GeoJSON."""
import json
import math
import os
from pathlib import Path

import shapefile

DATA_DIR = Path(__file__).resolve().parent
SOURCE_DIR = DATA_DIR.parent / "shpfiles"
OUT = DATA_DIR.parent / "portal" / "public" / "pk_floods_2026.geojson"
SIMPLIFY = 0.0002
MIN_AREA_KM2 = 0.01
KM2_PER_DEG2 = (111.32 * 110.54) * math.cos(math.radians(30.8))

SOURCES = [
    ("chfex", "chenab"),
    ("jhfex", "jhelum"),
    ("lihfex", "indus"),
    ("rhfex", "ravi"),
    ("shfex", "sutlej"),
    ("upper indus", "indus"),
]


def field_values(reader, record):
    return {field[0].lower(): value for field, value in zip(reader.fields[1:], record)}


def number(values, *names):
    for name in names:
        value = values.get(name)
        if value not in (None, ""):
            try:
                return int(float(value))
            except (TypeError, ValueError):
                continue
    return None


def area_km2(geometry):
    def ring_area(ring):
        return abs(sum(
            ring[index][0] * ring[(index + 1) % len(ring)][1]
            - ring[(index + 1) % len(ring)][0] * ring[index][1]
            for index in range(len(ring))
        )) / 2

    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        polygons = [coordinates]
    else:
        polygons = coordinates
    degrees = sum(ring_area(polygon[0]) for polygon in polygons)
    return degrees * KM2_PER_DEG2


features = []
dropped = 0
for folder, fallback_river in SOURCES:
    shp_path = next((SOURCE_DIR / folder).glob("*.shp"))
    reader = shapefile.Reader(str(shp_path))
    for record, source_shape in zip(reader.iterRecords(), reader.iterShapes()):
        values = field_values(reader, record)
        geometry = source_shape.__geo_interface__
        feature_area = area_km2(geometry)
        if feature_area < MIN_AREA_KM2:
            dropped += 1
            continue

        river_value = str(values.get("river_name") or "").strip().lower()
        river = river_value if river_value in {"chenab", "jhelum", "indus", "ravi", "sutlej"} else fallback_river
        low = number(values, "discharge_", "discharg_1")
        high = number(values, "discharg_1", "discharg_2")
        features.append({
            "type": "Feature",
            "properties": {
                "name": f"2026 {river.title()} flood extent",
                "kind": "flood",
                "event": "2026 river flood extent scenario",
                "year": 2026,
                "river": river,
                "discharge_min_cusecs": low,
                "discharge_max_cusecs": high,
                "source": "NEOC flood extent shapefiles",
                "speed": 0.15,
                "area_km2": round(feature_area, 1),
                "sdfMetersPerTexel": 250,
            },
            "geometry": geometry,
        })

collection = {
    "type": "FeatureCollection",
    "metadata": {
        "title": "Pakistan river flood extents, 2026",
        "year": 2026,
        "source": "NEOC flood extent shapefiles",
        "crs": "WGS 84",
    },
    "features": features,
}
OUT.write_text(json.dumps(collection, separators=(",", ":")), encoding="utf-8")
print(f"wrote {OUT} with {len(features)} features; dropped {dropped}")
print(f"total extent {sum(f['properties']['area_km2'] for f in features):.1f} km2")
