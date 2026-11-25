#!/usr/bin/env python3
"""Downloads the incoming (120th) Congress roster from Wikipedia and the matching
Wikidata records into data/raw/. Run before build_seed.py to refresh."""
import json, pathlib, subprocess, urllib.parse, time

RAW = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"
UA = {"User-Agent": "civic-data-script/0.1"}


def get(url, params):
    # curl rather than urllib: python.org builds on macOS often ship without CA certificates
    for attempt in range(4):
        out = subprocess.run(["curl", "-sS", "-m", "60", "-H", "User-Agent: " + UA["User-Agent"],
                              "--data", urllib.parse.urlencode(params), url], check=True, capture_output=True)
        try:
            return json.loads(out.stdout)
        except ValueError:
            print("retrying:", out.stdout[:120])
            time.sleep(5 * (attempt + 1))
    raise SystemExit("request kept failing: " + url)


import sys
for page, out in [("120th_United_States_Congress", "wp_120th.json"),
                  ("List_of_new_members_of_the_120th_United_States_Congress", "wp_120th_new.json")]:
    if (RAW / out).exists() and "--refresh" not in sys.argv:
        continue  # pass --refresh to re-download the Wikipedia pages
    d = get("https://en.wikipedia.org/w/api.php", {"action": "parse", "page": page, "prop": "wikitext|revid",
                                                    "format": "json", "redirects": 1})
    (RAW / out).write_text(json.dumps(d))
    time.sleep(2)

import importlib.util
spec = importlib.util.spec_from_file_location("roster", pathlib.Path(__file__).with_name("roster120.py"))
roster = importlib.util.module_from_spec(spec); spec.loader.exec_module(roster)
rows = roster.parse(RAW / "wp_120th.json")
titles = sorted({r["wiki"] for r in rows if not r["undecided"]})
qid, ents = {}, {}


def lookup(batch, normalize=False):
    params = {"action": "wbgetentities", "sites": "enwiki", "titles": "|".join(batch),
              "props": "claims|sitelinks", "sitefilter": "enwiki", "format": "json"}
    if normalize:
        params["normalize"] = 1
    d = get("https://www.wikidata.org/w/api.php", params)
    for q, e in d.get("entities", {}).items():
        if not q.startswith("Q"):
            continue
        title = e.get("sitelinks", {}).get("enwiki", {}).get("title")
        key = batch[0] if normalize else title
        if key:
            qid[key] = q
            ents[q] = e
    time.sleep(1)


for i in range(0, len(titles), 40):
    lookup(titles[i:i + 40])
for t in [t for t in titles if t not in qid]:
    lookup([t], normalize=True)  # redirects / alternate spellings, one at a time
WANT = {"P1157": "bioguide", "P2002": "twitter", "P12361": "bluesky", "P2003": "instagram", "P2013": "facebook",
        "P856": "website", "P18": "image", "P1839": "fec", "P4691": "opensecrets", "P2397": "youtube_id"}
out = {}
for title, q in qid.items():
    rec = {"qid": q}
    for prop, key in WANT.items():
        vals = []
        for c in ents.get(q, {}).get("claims", {}).get(prop, []):
            if c.get("rank") == "deprecated" or "P582" in c.get("qualifiers", {}):
                continue
            v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
            if isinstance(v, str):
                vals.append(v)
        if vals:
            rec[key] = vals
    out[title] = rec
(RAW / "wd_120.json").write_text(json.dumps(out))
print("roster rows", len(rows), "titles", len(titles), "with wikidata", len(out))
