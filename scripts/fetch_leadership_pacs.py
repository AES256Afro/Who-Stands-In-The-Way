#!/usr/bin/env python3
"""Leadership PACs and the members who sponsor them, from the FEC API (DEMO_KEY, ~10 requests).
Writes data/raw/leadership_pacs.json. The bulk files rarely record a leadership PAC's sponsor."""
import json, pathlib, subprocess, time

RAW = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"
out, page = [], 1
while True:
    url = f"https://api.open.fec.gov/v1/committees/?designation=D&cycle=2026&per_page=100&page={page}&api_key=DEMO_KEY"
    d = json.loads(subprocess.run(["curl", "-sS", "-m", "60", url], capture_output=True, check=True).stdout)
    if "results" not in d:
        raise SystemExit(f"FEC API error: {str(d)[:200]}")
    out += [{"id": c["committee_id"], "name": c["name"], "sponsors": c.get("sponsor_candidate_ids") or []} for c in d["results"]]
    if page >= d["pagination"]["pages"]:
        break
    page += 1
    time.sleep(1)
(RAW / "leadership_pacs.json").write_text(json.dumps(out))
print("leadership PACs", len(out), "with sponsor", sum(1 for x in out if x["sponsors"]))
