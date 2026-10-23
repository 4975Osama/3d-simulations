#!/usr/bin/env python3
"""Real population exposure from WorldPop.

Source: WorldPop 2020 UN-adjusted population counts, 1 km (30 arc-second),
Pakistan - https://hub.worldpop.org/  (CC BY 4.0). Download once:
  curl -L -o data/raw/pak_pop_2020_1km.tif \
    https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/2020/PAK/pak_ppp_2020_1km_Aggregated_UNadj.tif

Writes:
  * `pop` (people living inside the polygon, area-weighted per 1 km cell) on
    every feature of portal/public/pk_floods.geojson and pk_floods_2026.geojson
  * portal/public/pop_grid.json: the same grid cropped to the twin's city
    boxes, for street-model exposure (people per km2 per cell)
"""
import json
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import shape

import geotiff

DATA = Path(__file__).resolve().parent
PUBLIC = DATA.parent / 'portal' / 'public'
TIF = DATA / 'raw' / 'pak_pop_2020_1km.tif'
# keep in step with REGIONS[*].bbox of the city entries in portal/twin.js
CITIES = {
    'karachi': [66.6, 24.6, 67.6, 25.3], 'lahore': [74.0, 31.3, 74.7, 31.7],
    'islamabad': [72.8, 33.5, 73.4, 33.9], 'peshawar': [71.3, 33.8, 71.8, 34.2],
    'hyderabad': [68.2, 25.2, 68.7, 25.6], 'sukkur': [68.6, 27.5, 69.2, 28.0],
}

pop, (west, north, dx, dy), nodata = geotiff.read(TIF)
pop = np.where(pop > 0, pop, 0).astype(np.float64)
H, W = pop.shape
print(f'WorldPop grid {W}x{H}, total {pop.sum() / 1e6:.1f} M people')


def exposure(geom):
    """people in geom: each cell counts by the share of its area inside"""
    w, s, e, n = geom.bounds
    c0, c1 = max(0, int((w - west) / dx)), min(W - 1, int((e - west) / dx))
    r0, r1 = max(0, int((north - n) / dy)), min(H - 1, int((north - s) / dy))
    if c1 < c0 or r1 < r0:
        return 0.0
    cols, rows = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
    cols, rows = cols.ravel(), rows.ravel()
    vals = pop[rows, cols]
    keep = vals > 0
    if not keep.any():
        return 0.0
    cols, rows, vals = cols[keep], rows[keep], vals[keep]
    x0 = west + cols * dx
    y1 = north - rows * dy
    boxes = shapely.box(x0, y1 - dy, x0 + dx, y1)
    shapely.prepare(geom)
    inside = shapely.contains(geom, boxes)
    share = np.where(inside, 1.0, 0.0)
    edge = ~inside & shapely.intersects(geom, boxes)
    if edge.any():
        share[edge] = shapely.area(shapely.intersection(geom, boxes[edge])) / (dx * dy)
    return float((vals * share).sum())


for name in ('pk_floods.geojson', 'pk_floods_2026.geojson'):
    path = PUBLIC / name
    fc = json.loads(path.read_text(encoding='utf-8'))
    total = 0
    for f in fc['features']:
        g = shape(f['geometry'])
        if not g.is_valid:
            g = shapely.make_valid(g)
        p = round(exposure(g))
        f['properties']['pop'] = p
        total += p
    fc.setdefault('metadata', {})['population'] = 'WorldPop 2020 UN-adjusted, 1 km (CC BY 4.0), area-weighted'
    path.write_text(json.dumps(fc, separators=(',', ':')), encoding='utf-8')
    print(f'{name}: {len(fc["features"])} sheets, {total / 1e6:.2f} M people inside')

grids = {}
for city, (w, s, e, n) in CITIES.items():
    c0, c1 = int((w - west) / dx), int((e - west) / dx) + 1
    r0, r1 = int((north - n) / dy), int((north - s) / dy) + 1
    block = pop[r0:r1, c0:c1]
    km2 = (dx * 111.32 * np.cos(np.radians((n + s) / 2))) * (dy * 110.57)
    grids[city] = {
        'west': west + c0 * dx, 'north': north - r0 * dy, 'dx': dx, 'dy': dy,
        'w': block.shape[1], 'h': block.shape[0],
        'density': [round(v / km2) for v in block.ravel()],   # people per km2
    }
    print(f'{city}: {block.sum() / 1e6:.2f} M people in its box')
(PUBLIC / 'pop_grid.json').write_text(json.dumps({
    'source': 'WorldPop 2020 UN-adjusted population, 1 km (CC BY 4.0)', 'cities': grids,
}, separators=(',', ':')), encoding='utf-8')
