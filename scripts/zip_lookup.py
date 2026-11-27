#!/usr/bin/env python3
"""Builds the ZIP -> congressional district lookup for the 120th Congress (districts in effect from
January 3, 2027, including the nine states that redrew for 2026).

Overlays Census ZIP Code Tabulation Areas (cb_2020_us_zcta520_500k) on the Census TIGER 2026 "cd120"
district shapes and records, for each ZIP, the districts it touches and the share of its land area in
each. Output: public/zip/<first digit>.json, served as static files and loaded on demand by the site.

Run with the project venv (shapely, pyshp):  .venv/bin/python scripts/zip_lookup.py
"""
import glob, io, json, pathlib, zipfile, collections

import shapefile
from shapely.geometry import shape
from shapely.strtree import STRtree
from shapely.validation import make_valid

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEO = ROOT / "data" / "raw" / "geo"
OUT = ROOT / "public" / "zip"
FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
        "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
        "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
        "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
        "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
        "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
        "72": "PR", "78": "VI"}
MIN_SHARE = 0.02  # ignore slivers under 2% of a ZIP's area (map-edge noise)


def read_shp(zpath):
    with zipfile.ZipFile(zpath) as z:
        base = next(n[:-4] for n in z.namelist() if n.endswith(".shp"))
        r = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")),
                             shx=io.BytesIO(z.read(base + ".shx")))
        fields = [f[0] for f in r.fields[1:]]
        for sr in r.iterShapeRecords():
            g = shape(sr.shape.__geo_interface__)
            if not g.is_valid:
                g = make_valid(g)
            yield dict(zip(fields, sr.record)), g


districts, labels = [], []
for f in sorted(glob.glob(str(GEO / "cd120" / "tl_2026_*_cd120.zip"))):
    for rec, g in read_shp(f):
        cd = next((rec[k] for k in rec if k.startswith("CD") and k.endswith("FP")), None)
        st = FIPS.get(rec["STATEFP"])
        if not st or cd in (None, "ZZ"):  # ZZ = water-only areas
            continue
        districts.append(g)
        labels.append((st, 0 if cd in ("00", "98", "99") else int(cd)))
tree = STRtree(districts)
print("districts", len(districts))

lookup = {}
for rec, z in read_shp(GEO / "zcta.zip"):
    zcta = rec["ZCTA5CE20"]
    area = z.area
    if not area:
        continue
    parts = collections.defaultdict(float)
    for i in tree.query(z):
        inter = z.intersection(districts[i]).area
        if inter > 0:
            parts[labels[i]] += inter
    tot = sum(parts.values()) or 1
    kept = sorted(((k, v / tot) for k, v in parts.items() if v / tot >= MIN_SHARE), key=lambda kv: -kv[1])
    if kept:
        s = sum(v for _, v in kept)
        lookup[zcta] = [[st, d, round(v / s * 100)] for (st, d), v in kept]

OUT.mkdir(parents=True, exist_ok=True)
shards = collections.defaultdict(dict)
for zc, v in lookup.items():
    shards[zc[0]][zc] = v
for k, v in shards.items():
    (OUT / f"{k}.json").write_text(json.dumps(v, separators=(",", ":")))
split = sum(1 for v in lookup.values() if len(v) > 1)
print("zips", len(lookup), "split across districts", split, "files", sorted(shards))
