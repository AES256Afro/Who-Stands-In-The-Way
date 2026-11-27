#!/usr/bin/env python3
"""Compares a freshly built seed with the previous one and fails (exit 1) if something looks broken,
so an automated refresh never deploys bad data. Usage: check_refresh.py previous.json new.json"""
import json, sys, pathlib

old, new = (json.load(open(f, encoding="utf-8")) for f in sys.argv[1:3])
ROOT = pathlib.Path(__file__).resolve().parent.parent
problems, notes = [], []


def stats(s):
    t120 = {t["politician_id"] for t in s["terms"] if t["congress"] == 120}
    fin = [f["data"] for f in s["finance"]]
    return {
        "members_2027": len(t120),
        "with_fec_data": sum(1 for d in fin if d.get("has_data")),
        "receipts": sum((d.get("totals") or {}).get("receipts", 0) for d in fin),
        "health_pacs": sum(d.get("health_total", 0) for d in fin),
        "races": len(s.get("races", [])),
        "positions": len(s.get("positions", [])),
        "undecided": s.get("meta", {}).get("undecided", []),
    }


a, b = stats(old), stats(new)
for k in ("members_2027", "with_fec_data", "races", "positions"):
    if b[k] < a[k] * 0.95:
        problems.append(f"{k} fell from {a[k]} to {b[k]}")
for k in ("receipts", "health_pacs"):
    if b[k] < a[k] * 0.9:  # money only grows during a cycle; a big drop means a bad download
        problems.append(f"{k} fell from {a[k]:,.0f} to {b[k]:,.0f}")
for f, minimum in (("public/money/committees.json", 1_000_000), ("public/money/donors.json", 100_000), ("public/votes/house.json", 300_000), ("public/votes/senate.json", 300_000)):
    size = (ROOT / f).stat().st_size if (ROOT / f).exists() else 0
    if size < minimum:
        problems.append(f"{f} is only {size} bytes")
if a["undecided"] != b["undecided"]:
    notes.append(f"undecided seats changed: {a['undecided']} -> {b['undecided']}")
notes.append(f"receipts {a['receipts']:,.0f} -> {b['receipts']:,.0f}; members with FEC data {a['with_fec_data']} -> {b['with_fec_data']}")
print("\n".join(notes))
if problems:
    print("REFRESH CHECK FAILED:\n- " + "\n- ".join(problems))
    sys.exit(1)
print("refresh check passed")
