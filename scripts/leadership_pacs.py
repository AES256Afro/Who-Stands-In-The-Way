#!/usr/bin/env python3
"""Aggregates committee gifts to members' leadership PACs from the FEC committee-to-committee
file (data/raw/oth26.zip, ~1.9 GB unzipped, streamed). Writes data/raw/lpac_agg.json.
Leadership PAC sponsors come from the FEC API (data/raw/leadership_pacs.json)."""
import collections, io, json, pathlib, zipfile

RAW = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"
lpacs = {c["id"]: c for c in json.load(open(RAW / "leadership_pacs.json"))}
agg = collections.defaultdict(lambda: collections.defaultdict(float))
rows = 0
with zipfile.ZipFile(RAW / "oth26.zip") as z, z.open("itoth.txt") as fh:
    for line in io.TextIOWrapper(fh, encoding="latin-1"):
        f = line.rstrip("\n").split("|")
        if len(f) < 19 or f[0] not in lpacs:
            continue
        # 18K = contribution received from a registered committee; skip memo lines (double counting)
        if f[5] != "18K" or f[18] == "X" or not f[15]:
            continue
        try:
            agg[f[0]][f[15]] += float(f[14] or 0)
        except ValueError:
            continue
        rows += 1
out = {k: {"name": lpacs[k]["name"], "sponsors": lpacs[k]["sponsors"],
           "gifts": {d: round(v, 2) for d, v in g.items() if v > 0}} for k, g in agg.items()}
for k, c in lpacs.items():  # include leadership PACs with no PAC gifts so profiles can still name them
    out.setdefault(k, {"name": c["name"], "sponsors": c["sponsors"], "gifts": {}})
(RAW / "lpac_agg.json").write_text(json.dumps(out))
print("rows", rows, "lpacs with gifts", sum(1 for v in out.values() if v["gifts"]), "total", round(sum(sum(v["gifts"].values()) for v in out.values())))
