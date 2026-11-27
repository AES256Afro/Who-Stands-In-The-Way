#!/usr/bin/env python3
"""ZIP -> state legislative districts (state senate and state house), for the "find your rep" lookup.

Overlays Census ZIP Code Tabulation Areas on Census TIGER 2026 SLDU/SLDL shapes (data/raw/geo/sld/) and
labels each district with the district name Open States uses (data/raw/state_officials.json), so the
site can match legislators by their `sdistrict`. Writes public/zipstate/<first digit>.json:
  {"02139": {"u": [[["Second Middlesex"], 88], ...], "l": [[["25th Middlesex"], 70], ...]}}
Each entry lists the Open States district label(s) for one area (Idaho's seats A and B share one) and
the share of the ZIP's area in it. Run with the venv:  .venv/bin/python scripts/state_zip_lookup.py
"""
import collections, glob, io, json, pathlib, re, zipfile

import shapefile
from shapely.geometry import shape
from shapely.strtree import STRtree
from shapely.validation import make_valid

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "zipstate"
FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
        "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
        "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
        "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
        "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"}
ORD = {"FIRST": "1", "SECOND": "2", "THIRD": "3", "FOURTH": "4", "FIFTH": "5", "SIXTH": "6", "SEVENTH": "7", "EIGHTH": "8",
       "NINTH": "9", "TENTH": "10", "ELEVENTH": "11", "TWELFTH": "12", "THIRTEENTH": "13", "FOURTEENTH": "14", "FIFTEENTH": "15",
       "SIXTEENTH": "16", "SEVENTEENTH": "17", "EIGHTEENTH": "18", "NINETEENTH": "19", "TWENTIETH": "20"}
MIN_SHARE = 0.03


def norm(s):
    s = str(s or "").upper().replace("&", " AND ").replace("-", " ")
    s = re.sub(r"\b(STATE|SENATE|SENATORIAL|HOUSE|ASSEMBLY|LEGISLATIVE|REPRESENTATIVE|DISTRICT|COUNTY|DIST|HD|SD|AD)\b", " ", s)
    s = re.sub(r"\b(\d+)(ST|ND|RD|TH)\b", r"\1", s)
    s = " ".join(ORD.get(w, w) for w in re.sub(r"[^A-Z0-9 ]+", " ", s).split())
    return re.sub(r"\b0+(\d)", r"\1", s).strip()


people = json.load(open(RAW / "state_officials.json", encoding="utf-8"))["people"]
os_labels = collections.defaultdict(dict)  # (st, kind) -> {normalized: [raw labels]}
for p in people:
    if p["chamber"] in ("state_upper", "state_lower") and p.get("sdistrict"):
        kind = "u" if p["chamber"] == "state_upper" else "l"
        os_labels[(p["state"], kind)].setdefault(norm(p["sdistrict"]), [])
        if p["sdistrict"] not in os_labels[(p["state"], kind)][norm(p["sdistrict"])]:
            os_labels[(p["state"], kind)][norm(p["sdistrict"])].append(p["sdistrict"])
# Idaho elects two House members (seats A and B) per legislative district.
for key in [k for k in os_labels if k == ("ID", "l")]:
    merged = collections.defaultdict(list)
    for n, raws in os_labels[key].items():
        merged[re.sub(r"\s*[AB]$", "", n)] += raws
    os_labels[key] = dict(merged)


def label_for(st, kind, rec):
    labels = os_labels.get((st, kind), {})
    code = rec.get("SLDUST") or rec.get("SLDLST") or ""
    for cand in (norm(code), norm(rec.get("NAMELSAD")), norm(rec.get("NAME"))):
        if cand and cand in labels:
            return labels[cand]
    return None


geoms, keys, matched, unmatched = [], [], collections.Counter(), collections.Counter()
for f in sorted(glob.glob(str(RAW / "geo" / "sld" / "tl_2026_*_sld*.zip"))):
    kind = "u" if "sldu" in f else "l"
    with zipfile.ZipFile(f) as z:
        base = next(n[:-4] for n in z.namelist() if n.endswith(".shp"))
        rd = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")), shx=io.BytesIO(z.read(base + ".shx")))
        fields = [x[0] for x in rd.fields[1:]]
        for sr in rd.iterShapeRecords():
            rec = dict(zip(fields, sr.record))
            st = FIPS.get(rec["STATEFP"])
            if not st or str(rec.get("SLDUST") or rec.get("SLDLST") or "").startswith("ZZZ"):
                continue
            lab = label_for(st, kind, rec)
            if not lab:
                unmatched[(st, kind)] += 1
                continue
            matched[(st, kind)] += 1
            g = shape(sr.shape.__geo_interface__)
            geoms.append(g if g.is_valid else make_valid(g))
            keys.append((st, kind, lab))
tree = STRtree(geoms)
print("districts matched", sum(matched.values()), "unmatched", sum(unmatched.values()))
print("unmatched by state:", {f"{s}-{k}": n for (s, k), n in unmatched.items() if n})

with zipfile.ZipFile(RAW / "geo" / "zcta.zip") as z:
    base = next(n[:-4] for n in z.namelist() if n.endswith(".shp"))
    rd = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")), shx=io.BytesIO(z.read(base + ".shx")))
    fields = [x[0] for x in rd.fields[1:]]
    out = collections.defaultdict(dict)
    for sr in rd.iterShapeRecords():
        zc = dict(zip(fields, sr.record))["ZCTA5CE20"]
        g = shape(sr.shape.__geo_interface__)
        if not g.is_valid:
            g = make_valid(g)
        parts = {"u": collections.defaultdict(float), "l": collections.defaultdict(float)}
        for i in tree.query(g):
            a = g.intersection(geoms[i]).area
            if a > 0:
                st, kind, lab = keys[i]
                parts[kind][(st, tuple(lab))] += a
        entry = {}
        for kind, d in parts.items():
            tot = sum(d.values())
            kept = [(k, v / tot) for k, v in d.items() if tot and v / tot >= MIN_SHARE]
            if kept:
                s = sum(v for _, v in kept)
                entry[kind] = [[list(k[1]), round(v / s * 100)] for k, v in sorted(kept, key=lambda kv: -kv[1])]
        if entry:
            out[zc[0]][zc] = entry

OUT.mkdir(parents=True, exist_ok=True)
for d, v in out.items():
    (OUT / f"{d}.json").write_text(json.dumps(v, separators=(",", ":"), ensure_ascii=False))
print("zips", sum(len(v) for v in out.values()), "bytes", sum((OUT / f"{d}.json").stat().st_size for d in out))
