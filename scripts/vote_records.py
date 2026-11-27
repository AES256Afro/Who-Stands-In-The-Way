#!/usr/bin/env python3
"""Full voting records for the 119th Congress from Voteview (data/raw/votes/HS119_*.csv).

Writes public/votes/house.json and public/votes/senate.json:
  rolls:   [[roll, date, bill, question, description, result, yea, nay, topics, url, dMaj, rMaj], ...]
  members: {bioguide: "YN-P ..."}  one character per roll: Y yes, N no, P present, - didn't vote,
           space = not a member of the chamber for that vote
dMaj / rMaj: how most Democrats / Republicans voted ("Y", "N" or "" if split evenly or none voted).
"""
import collections, csv, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
V = ROOT / "data" / "raw" / "votes"
OUT = ROOT / "public" / "votes"

TOPICS = [
    ("health", r"health|medicaid|medicare|affordable care|premium tax credit|insulin|prescription|drug pric|hospital|340b|pharmac|obamacare|\bhhs\b|human services|disease|vaccin|abortion|maternal"),
    ("budget", r"appropriation|reconciliation|budget|continuing|debt limit|rescission|one big beautiful|spending|deficit"),
    ("taxes", r"\btax|internal revenue|tariff"),
    ("immigration", r"immigra|border|asylum|deport|\bice\b|alien|laken riley|citizenship"),
    ("military", r"defense|armed forces|military|veteran|hostilities|war powers|national guard|nato|ukraine|israel|iran"),
    ("energy", r"energy|climate|\boil\b|natural gas|\bcoal\b|emission|\bepa\b|environmental protection|\bwind\b|solar|nuclear|pipeline|drilling"),
    ("labor", r"labor|worker|wage|union|nlrb|employment|social security"),
    ("guns", r"firearm|gun|second amendment"),
    ("civil rights", r"voting rights|election|civil rights|transgender|gender|discriminat|dei\b"),
    ("nominations", r"^PN\d|nomination|to be (?:a |an |the )?(?:secretary|judge|ambassador|director|administrator|member|commissioner|deputy|assistant|under secretary|attorney)"),
]
TOPIC_RX = [(t, re.compile(rx, re.I)) for t, rx in TOPICS]


def cast(code):
    c = int(float(code))
    return "Y" if c in (1, 2, 3) else "N" if c in (4, 5, 6) else "P" if c == 7 else "-"


members = {}
for row in csv.DictReader(open(V / "HS119_members.csv", encoding="utf-8")):
    if row["chamber"] in ("House", "Senate") and row["bioguide_id"]:
        members[(row["chamber"], row["icpsr"])] = (row["bioguide_id"], row["party_code"])

rolls = collections.defaultdict(list)
for x in csv.DictReader(open(V / "HS119_rollcalls.csv", encoding="utf-8")):
    rolls[x["chamber"]].append(x)

votes = collections.defaultdict(dict)  # (chamber) -> {(bio): {roll: char}}
party_tally = collections.defaultdict(lambda: collections.Counter())
for row in csv.DictReader(open(V / "HS119_votes.csv", encoding="utf-8")):
    m = members.get((row["chamber"], row["icpsr"]))
    if not m:
        continue
    bio, pc = m
    ch = cast(row["cast_code"])
    votes[row["chamber"]].setdefault(bio, {})[row["rollnumber"]] = ch
    if ch in "YN":
        party_tally[(row["chamber"], row["rollnumber"], {"100": "D", "200": "R"}.get(pc, "I"))][ch] += 1

OUT.mkdir(parents=True, exist_ok=True)
for chamber in ("House", "Senate"):
    rs = sorted(rolls[chamber], key=lambda x: int(x["rollnumber"]))
    out_rolls = []
    for x in rs:
        desc = (x["vote_desc"] or x["dtl_desc"] or "").strip()
        text = f"{x['bill_number']} {desc} {x['vote_question']}"
        topics = [t for t, rx in TOPIC_RX if rx.search(text)]
        session = int(x["session"] or 1)
        year = 2024 + session
        cr = int(x["clerk_rollnumber"] or x["rollnumber"])
        url = (f"https://clerk.house.gov/Votes/{year}{cr}" if chamber == "House" else
               f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote119{session}/vote_119_{session}_{cr:05d}.htm")
        maj = []
        for p in ("D", "R"):
            t = party_tally[(chamber, x["rollnumber"], p)]
            maj.append("Y" if t["Y"] > t["N"] else "N" if t["N"] > t["Y"] else "")
        out_rolls.append([int(x["rollnumber"]), x["date"], x["bill_number"], x["vote_question"], desc,
                          x["vote_result"], int(float(x["yea_count"] or 0)), int(float(x["nay_count"] or 0)),
                          topics, url] + maj)
    idx = [str(r[0]) for r in out_rolls]
    mem = {bio: "".join(v.get(i, " ") for i in idx) for bio, v in votes[chamber].items()}
    (OUT / f"{chamber.lower()}.json").write_text(json.dumps({"rolls": out_rolls, "members": mem}, separators=(",", ":")))
    print(chamber, "rolls", len(out_rolls), "members", len(mem), "bytes", (OUT / f"{chamber.lower()}.json").stat().st_size,
          "topics", collections.Counter(t for r in out_rolls for t in r[8]).most_common(5))
