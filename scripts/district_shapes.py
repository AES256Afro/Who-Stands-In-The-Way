#!/usr/bin/env python3
"""Simplified 120th-Congress district shapes (and state outlines) for the dashboard's district map.
Reads the Census TIGER 2026 cd120 files in data/raw/geo/cd120/ and writes public/geo/districts.json:
  {"districts": [{"id": "TX-07", "st": "TX", "d": 7, "g": <GeoJSON geometry>}], "states": [{"st": "TX", "g": ...}]}
Run with the project venv:  .venv/bin/python scripts/district_shapes.py
"""
import glob, io, json, pathlib, zipfile, collections

import shapefile
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from shapely.validation import make_valid

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEO = ROOT / "data" / "raw" / "geo"
OUT = ROOT / "public" / "geo"
FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
        "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
        "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
        "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
        "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
        "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"}  # territories are left off the map
TOL = {"AK": 0.05}  # degrees; Alaska is huge and jagged


def rnd(geom, nd=3):
    def r(c):
        return [round(x, nd) for x in c] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    g = mapping(geom)
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


districts, by_state = [], collections.defaultdict(list)
for f in sorted(glob.glob(str(GEO / "cd120" / "tl_2026_*_cd120.zip"))):
    with zipfile.ZipFile(f) as z:
        base = next(n[:-4] for n in z.namelist() if n.endswith(".shp"))
        rd = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")), shx=io.BytesIO(z.read(base + ".shx")))
        fields = [x[0] for x in rd.fields[1:]]
        for sr in rd.iterShapeRecords():
            rec = dict(zip(fields, sr.record))
            st = FIPS.get(rec["STATEFP"])
            cd = next((rec[k] for k in rec if k.startswith("CD") and k.endswith("FP")), None)
            if not st or cd in (None, "ZZ"):
                continue
            g = shape(sr.shape.__geo_interface__)
            if not g.is_valid:
                g = make_valid(g)
            # Area-relative tolerance: small urban districts keep detail, big rural ones simplify more.
            tol = TOL.get(st, min(0.02, max(0.002, (g.area ** 0.5) * 0.01)))
            s = g.simplify(tol, preserve_topology=True)
            if s.is_empty:
                continue
            d = 0 if cd in ("00", "98", "99") else int(cd)
            districts.append({"id": f"{st}-{d:02d}" if d else f"{st}-AL", "st": st, "d": d, "g": rnd(s)})
            by_state[st].append(g)

states = []
for st, gs in by_state.items():
    u = unary_union(gs).simplify(TOL.get(st, 0.02), preserve_topology=True)
    states.append({"st": st, "g": rnd(u)})

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "districts.json").write_text(json.dumps({"districts": districts, "states": states}, separators=(",", ":")))
print("districts", len(districts), "states", len(states), "bytes", (OUT / "districts.json").stat().st_size)
