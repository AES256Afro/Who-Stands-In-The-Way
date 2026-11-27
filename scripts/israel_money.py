#!/usr/bin/env python3
"""Totals donations that individuals routed through pro-Israel PACs acting as conduits (FEC "earmarked"
contributions, transaction type 15E, where OTHER_ID is the conduit PAC), per candidate committee, from the
FEC individual contributions file (data/raw/indiv26.zip, streamed). Writes data/raw/israel_agg.json.

Only totals and counts per recipient committee are kept: no donor names. Direct PAC gifts and outside
spending come from itpas2.txt and the independent expenditure file in build_seed.py.
"""
import collections, io, json, pathlib, zipfile

RAW = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"
CONDUITS = {"C00797670": "aipac", "C00247403": "norpac"}  # AIPAC PAC, NORPAC

agg = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0, 0]))
with zipfile.ZipFile(RAW / "indiv26.zip") as z, z.open("itcont.txt") as fh:
    for line in io.TextIOWrapper(fh, encoding="latin-1"):
        f = line.rstrip("\n").split("|")
        if len(f) < 19 or f[15] not in CONDUITS or f[0] in CONDUITS:
            continue
        if f[5] not in ("15E", "22Y") or f[18] == "X":
            continue
        try:
            amt = float(f[14] or 0)
        except ValueError:
            continue
        if f[5] == "22Y":
            amt = -abs(amt)
        cell = agg[f[0]][CONDUITS[f[15]]]
        cell[0] += amt
        cell[1] += 1 if amt > 0 else 0

out = {cmte: {k: {"amount": round(v[0], 2), "count": v[1]} for k, v in d.items() if v[0] > 0} for cmte, d in agg.items()}
out = {k: v for k, v in out.items() if v}
(RAW / "israel_agg.json").write_text(json.dumps(out))
print("committees", len(out), "aipac earmarked", round(sum(v.get("aipac", {}).get("amount", 0) for v in out.values())),
      "norpac earmarked", round(sum(v.get("norpac", {}).get("amount", 0) for v in out.values())))
