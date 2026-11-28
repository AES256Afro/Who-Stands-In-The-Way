#!/usr/bin/env python3
"""Compares scripts/israel_career.py totals with Track AIPAC's published "Israel Lobby Total" per member
(data/raw/research/trackaipac_totals.json, parsed from their tracker page). Prints the match rate and the
largest gaps, for checking the method; nothing is written."""
import json, pathlib, re, statistics, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
car = json.load(open(RAW / "israel_career.json"))
ta = json.load(open(RAW / "research" / "trackaipac_totals.json"))
people = [p for p in json.load(open(ROOT / "seed" / "seed.json"))["politicians"] if p.get("level", "federal") != "state"]


def key(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"\b(jr|sr|ii|iii|iv)\b|[^a-z ]", " ", n).split()
    return (n[0], n[-1]) if n else ("", "")


by = {}
for p in people:
    by.setdefault(key(p["name"]), p)
    if p.get("first") and p.get("last"):
        by.setdefault(key(f'{p["first"]} {p["last"]}'), p)

rows = []
for t in ta:
    if t["total"] is None:
        continue
    p = by.get(key(t["name"]))
    if not p:
        continue
    c = car.get(p["id"], {})
    rows.append((p["id"], t["name"], t["total"], c.get("for", 0), c.get("vs_opponents", 0)))

print("compared", len(rows), "of", sum(1 for t in ta if t["total"] is not None))
for label, f in (("for", lambda r: r[3]), ("for + vs_opponents", lambda r: r[3] + r[4])):
    close = sum(1 for r in rows if r[2] and abs(f(r) - r[2]) / r[2] <= 0.10)
    ratio = statistics.median([f(r) / r[2] for r in rows if r[2] > 10000])
    print(f"{label}: within 10% {close}/{len(rows)}, median ours/theirs {ratio:.2f}")
print("largest gaps (theirs - ours 'for'):")
for r in sorted(rows, key=lambda r: -(r[2] - r[3]))[:15]:
    print(f"  {r[1]:28} theirs {r[2]:>12,}  ours for {r[3]:>12,.0f}  vs opp {r[4]:>12,.0f}")
for n in ("Chuck Schumer", "Alma Adams", "Ed Gallrein", "Pete Aguilar"):
    print([r for r in rows if r[1] == n])
