#!/usr/bin/env python3
"""Adds researched industry votes (data/raw/research/industry_votes/*.json, one array per file in the
sector_votes.json item format) to scripts/sector_votes.json. Each vote must match a Voteview roll call
(data/raw/votes/HS119_rollcalls.csv) on chamber, rollnumber, clerk roll and date, and carry a source for
the industry's side; anything else is reported and skipped. Re-running is safe: an existing
(sector, chamber, rollnumber) is updated in place, not duplicated."""
import csv, glob, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SV = ROOT / "scripts" / "sector_votes.json"
rolls = {(r["chamber"].lower(), int(r["rollnumber"])): r for r in csv.DictReader(open(ROOT / "data" / "raw" / "votes" / "HS119_rollcalls.csv"))}
votes = json.load(open(SV, encoding="utf-8"))
index = {(v["sector"], v["chamber"], int(v["rollnumber"])): i for i, v in enumerate(votes)}
added = updated = 0
for path in sorted(glob.glob(str(ROOT / "data" / "raw" / "research" / "industry_votes" / "*.json"))):
    for v in json.load(open(path, encoding="utf-8")):
        r = rolls.get((v["chamber"], int(v["rollnumber"])))
        problem = (not r and "no such roll call") or (int(r["clerk_rollnumber"]) != int(v["clerk_roll"]) and "clerk roll differs") \
            or (r["date"] != v["date"] and f"date differs ({r['date']})") or (v["industry_side"] not in ("yea", "nay") and "bad side") \
            or (not v.get("industry_source_url", "").startswith("http") and "no source")
        if problem:
            print("skip", pathlib.Path(path).name, v["chamber"], v["rollnumber"], v["title"][:50], "-", problem)
            continue
        item = {"id": f'{v["chamber"][0]}119-{v["sector"]}-{v["rollnumber"]}', "chamber": v["chamber"], "rollnumber": int(v["rollnumber"]),
                "clerk_roll": int(v["clerk_roll"]), "date": v["date"], "sort": 1, "title": v["title"], "question": v["question"],
                "yes_means": v["yes_means"], "source_url": v["source_url"], "sector": v["sector"], "industry_side": v["industry_side"],
                "industry_position": v["industry_position"], "industry_source_url": v["industry_source_url"]}
        k = (item["sector"], item["chamber"], item["rollnumber"])
        if k in index:
            item["id"] = votes[index[k]]["id"]
            votes[index[k]] = item
            updated += 1
        else:
            index[k] = len(votes)
            votes.append(item)
            added += 1
json.dump(votes, open(SV, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("added", added, "updated", updated, "total", len(votes))
