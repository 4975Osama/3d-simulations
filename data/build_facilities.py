#!/usr/bin/env python3
"""Critical facilities from OpenStreetMap, tagged with the flood sheet (if any)
that covers each one, for the digital twin.

Source: OpenStreetMap contributors (ODbL), via the Overpass API. Download once:
  [out:json][timeout:300];
  area["ISO3166-1"="PK"][admin_level=2]->.pk;
  ( nwr["amenity"~"^(hospital|clinic|doctors|school|college|university|police|fire_station)$"](area.pk);
    nwr["power"~"^(plant|substation)$"](area.pk); );
  out center tags qt;
saved as data/raw/osm_facilities_pk.json

Writes portal/public/facilities.json:
  { source, osm_date, kinds: [...], f: [[lng, lat, kind, name, s2022, s2026], ...] }
  s20xx = index of the flood sheet (feature) the facility sits in, -1 if outside;
  the portal times the flooding from that sheet's reveal delay
"""
import json
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import shape

DATA = Path(__file__).resolve().parent
PUBLIC = DATA.parent / 'portal' / 'public'
RAW = DATA / 'raw' / 'osm_facilities_pk.json'

KINDS = ['hospital', 'clinic', 'school', 'college', 'police', 'fire', 'power']
AMENITY = {'hospital': 'hospital', 'clinic': 'clinic', 'doctors': 'clinic', 'school': 'school',
           'college': 'college', 'university': 'college', 'police': 'police', 'fire_station': 'fire'}


def kv(v):
    try:
        return max(int(float(x)) for x in str(v).split(';') if x.strip())
    except ValueError:
        return 0


raw = json.loads(RAW.read_text(encoding='utf-8'))
rows = []
for e in raw['elements']:
    t = e.get('tags', {})
    name = (t.get('name:en') or t.get('name') or '').strip()
    kind = AMENITY.get(t.get('amenity'))
    if not kind and t.get('power') == 'plant':
        # most OSM "plants" here are unnamed rooftop solar arrays: keep real generating stations
        if name or t.get('plant:source', '') not in ('', 'solar'):
            kind = 'power'
    elif not kind and t.get('power') == 'substation':
        if kv(t.get('voltage', '0')) >= 66000 or name:
            kind = 'power'
    if not kind:
        continue
    c = e.get('center') or {'lat': e.get('lat'), 'lon': e.get('lon')}
    if c['lat'] is None:
        continue
    rows.append([round(c['lon'], 5), round(c['lat'], 5), KINDS.index(kind), name])

pts = shapely.points(np.array([[r[0], r[1]] for r in rows]))
for name in ('pk_floods.geojson', 'pk_floods_2026.geojson'):
    fc = json.loads((PUBLIC / name).read_text(encoding='utf-8'))
    geoms = []
    for f in fc['features']:
        g = shape(f['geometry'])
        geoms.append(g if g.is_valid else shapely.make_valid(g))
    tree = shapely.STRtree(geoms)
    pi, gi = tree.query(pts, predicate='within')
    best = np.full(len(rows), -1)
    for p, g in zip(pi, gi):
        if best[p] < 0:
            best[p] = g
    for row, g in zip(rows, best):
        row.append(int(g))
    print(f'{name}: {(best >= 0).sum()} facilities inside a flood sheet')

counts = {k: sum(1 for r in rows if r[2] == i) for i, k in enumerate(KINDS)}
print('kept', len(rows), counts)
(PUBLIC / 'facilities.json').write_text(json.dumps({
    'source': 'OpenStreetMap contributors (ODbL)',
    'osm_date': raw['osm3s']['timestamp_osm_base'][:10],
    'kinds': KINDS, 'f': rows,
}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
