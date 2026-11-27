#!/usr/bin/env python3
"""Governors and state legislators.

Sources:
  - Open States people data (CC0), github.com/openstates/people, unpacked at data/raw/openstates/people-main
    (current legislators and governors with offices, phones, emails, links, social ids)
  - Wikipedia "2026 United States gubernatorial elections" (data/raw/wp_gov2026.json) for governors-elect
  - Research results in data/raw/research/state/ (governor stances, state single-payer bill sponsors)

Writes data/raw/state_officials.json, which build_seed.py merges into the seed. Run with the venv
(needs PyYAML):  .venv/bin/python scripts/state_officials.py
"""
import collections, datetime, glob, json, pathlib, re, sys, unicodedata

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OS = RAW / "openstates" / "people-main" / "data"
sys.path.insert(0, str(ROOT / "scripts"))
from results2026 import _candidates, _clean  # noqa: E402
from roster120 import STATES  # noqa: E402

TODAY = datetime.date.today().isoformat()
ABBR = {v: k for k, v in STATES.items()}
PARTY = {"Democratic": "D", "Republican": "R", "Independent": "I", "Democratic-Farmer-Labor": "D", "Democratic–Farmer–Labor": "D"}
LOWER_TITLE = {"CA": "Assemblymember", "NY": "Assemblymember", "NV": "Assemblymember", "WI": "Representative",
               "NJ": "Assemblymember", "MD": "Delegate", "VA": "Delegate", "WV": "Delegate"}
STATE_CODES = [s for s in sorted(set(STATES.values())) if s not in ("PR", "GU", "VI", "AS", "MP")]


def party_of(person):
    ps = person.get("party") or []
    cur = [p for p in ps if not p.get("end_date")] or ps
    # Fusion tickets come as one label, e.g. "Democratic/Working Families": the first party is the major one.
    names = [p["name"].split("/")[0].strip() for p in cur]
    if names and all(n == "Nonpartisan" for n in names):
        return ""  # Nebraska's unicameral legislature is officially nonpartisan
    # Fusion states list several parties (e.g. Democratic + Working Families): prefer the major party.
    for major in ("Democratic", "Democratic-Farmer-Labor", "Democratic–Farmer–Labor", "Republican"):
        if major in names:
            return PARTY[major]
    name = names[-1] if names else ""
    return PARTY.get(name, "I" if name else "")


def active(role):
    end = str(role.get("end_date") or "")
    start = str(role.get("start_date") or "")
    return (not end or end >= TODAY) and (not start or start <= TODAY)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-")


def contact(person):
    offices = person.get("offices") or []
    cap = next((o for o in offices if o.get("classification") == "capitol"), None) or (offices[0] if offices else {})
    links = [l["url"] for l in person.get("links") or [] if l.get("url")]
    web = next((u for u in links if "webform" not in u), "")
    form = next((l["url"] for l in person.get("links") or [] if l.get("note") == "webform"), "")
    dist = [{"city": "", "state": "", "address": o.get("address", ""), "zip": "", "phone": o.get("voice", ""), "fax": o.get("fax", "")}
            for o in offices if o.get("classification") == "district"]
    ids = person.get("ids") or {}
    return {"phone": cap.get("voice", ""), "office": cap.get("address", ""), "website": web, "contact_form": form,
            "email": person.get("email", ""), "offices": json.dumps(dist), "twitter": ids.get("twitter", ""),
            "facebook": ids.get("facebook", ""), "instagram": ids.get("instagram", ""), "youtube": ids.get("youtube", "")}


people = []
for st in STATE_CODES:
    d = OS / st.lower()
    for kind in ("legislature", "executive"):
        for f in sorted(glob.glob(str(d / kind / "*.yml"))):
            p = yaml.safe_load(open(f, encoding="utf-8"))
            roles = [r for r in p.get("roles") or [] if active(r)]
            for r in roles:
                if r.get("type") not in ("upper", "lower", "legislature", "governor"):
                    continue
                chamber = {"upper": "state_upper", "legislature": "state_upper", "lower": "state_lower", "governor": "governor"}[r["type"]]
                c = contact(p)
                title = (("Mayor" if st == "DC" else "Governor") if chamber == "governor" else ("State Senator" if chamber == "state_upper" else LOWER_TITLE.get(st, "State Representative")))
                if r["type"] == "legislature":
                    title = "State Senator" if st == "NE" else "Legislator"
                people.append({
                    "id": "OS-" + p["id"].split("/")[-1], "name": p["name"], "first": p.get("given_name") or p["name"].split()[0],
                    "last": p.get("family_name") or p["name"].split()[-1], "chamber": chamber, "role": title, "state": st,
                    "district": None, "sdistrict": str(r.get("district") or ""), "party": party_of(p), "voting": 1,
                    "status": "current", "term_start": str(r.get("start_date") or ""), "term_end": str(r.get("end_date") or ""),
                    "next_election": "", "photo_url": p.get("image", ""), "notes": "", "level": "state", **c,
                })
print("open states:", collections.Counter(x["chamber"] for x in people))

# ---------------------------------------------------------------- governors-elect (2026 races)
t = json.load(open(RAW / "wp_gov2026.json"))["parse"]["wikitext"]["*"]
t = t[t.find("Race summary"):]
elect = {}
for row in re.split(r"\n\|-", t):
    h = re.search(r"^\s*!\s*\[\[[^|\]]*\|([A-Z][A-Za-z .]+)\]\]", row.strip())
    if not h or h.group(1) not in STATES or STATES[h.group(1)] not in STATE_CODES:
        continue  # territories aren't covered
    st = STATES[h.group(1)]
    cands = _candidates(row)
    w = next((c for c in cands if c["won"]), None)
    status = _clean(row.split("\n|")[5] if row.count("\n|") >= 5 else "")
    if w and st not in elect:
        link = re.search(r"\{\{aye\}\}\s*'''\[\[([^\]|]+)", row, re.I)
        elect[st] = {"name": w["name"], "party": PARTY.get(w["party"], w["party"][:1]), "wiki": link.group(1) if link else "",
                     "result": status}
print("governor races parsed:", len(elect))

gov_now = {x["state"]: x for x in people if x["chamber"] == "governor"}
for st, e in elect.items():
    cur = gov_now.get(st)
    same = cur and slug(cur["last"]) in slug(e["name"])
    if same:
        cur["notes"] = "Re-elected in November 2026."
        continue
    if cur:
        cur["status"] = "departing"
        cur["notes"] = f"Leaving office; {e['name']} won the November 2026 election."
    toks = e["name"].split()
    people.append({
        "id": f"GOV-{st}-{slug(e['name'])}", "name": e["name"], "first": toks[0], "last": toks[-1], "chamber": "governor",
        "role": "Mayor-elect" if st == "DC" else "Governor-elect", "state": st, "district": None, "sdistrict": "", "party": e["party"], "voting": 1,
        "status": "incoming", "term_start": "", "term_end": "", "next_election": "", "photo_url": "",
        "notes": "Won the November 2026 election; takes office in early 2027.", "level": "state",
        "phone": "", "office": "", "website": "", "contact_form": "", "email": "", "offices": "[]",
        "twitter": "", "facebook": "", "instagram": "", "youtube": "", "wikipedia": e["wiki"],
    })

# ---------------------------------------------------------------- stances from research
positions = []
def load(pattern):
    out = []
    for f in sorted(glob.glob(str(RAW / "research" / "state" / pattern))):
        try:
            out += json.load(open(f, encoding="utf-8"))
        except ValueError as e:
            print("skipping", f, e)
    return out


by_state_last = collections.defaultdict(list)
for x in people:
    by_state_last[(x["state"], slug(x["last"]))].append(x)

for g in load("governors*.json"):
    if g.get("stance") not in ("supports", "public_option", "unclear", "opposes") or not re.match(r"https?://", g.get("source_url") or ""):
        continue
    st = g.get("state")
    match = [x for x in by_state_last.get((st, slug(g["name"].split()[-1])), []) if x["chamber"] == "governor"]
    if not match:
        continue
    conf = "low" if re.match(r"^https?://(?:www\.)?(?:ontheissues\.org|en\.wikipedia\.org|isidewith\.com)/", g["source_url"]) else g.get("confidence")
    stance, note = g["stance"], (g.get("note") or "").strip()
    if stance == "supports" and conf == "low":  # thin evidence doesn't count as support
        stance, note = "unclear", "Reported as a supporter, but not confirmed in their own words: " + note
    low = " Low confidence: verify before citing." if conf == "low" else ""
    for m in match:
        positions.append({"politician_id": m["id"], "policy_id": "m4a", "stance": stance,
                          "note": "Researched Nov 2026: " + note + low, "source_url": g["source_url"], "updated_at": TODAY})

# State single-payer bills: sponsors and cosponsors count as support for single payer in their state.
NICK = {"dave": "david", "bob": "robert", "rob": "robert", "bill": "william", "will": "william", "joe": "joseph",
        "mike": "michael", "jim": "james", "jimmy": "james", "tom": "thomas", "chris": "christopher", "dan": "daniel",
        "danny": "daniel", "pat": "patrick", "nick": "nicholas", "tony": "anthony", "liz": "elizabeth", "beth": "elizabeth",
        "kate": "katherine", "katie": "katherine", "sam": "samuel", "steve": "steven", "matt": "matthew", "al": "albert",
        "jen": "jennifer", "jenn": "jennifer", "ed": "edward", "ted": "edward", "andy": "andrew", "greg": "gregory"}


def same_given(a, b):
    """First names that refer to the same person: equal, one a prefix of the other, or a common nickname."""
    if not a or not b:
        return False
    return a == b or a.startswith(b) or b.startswith(a) or NICK.get(a, a) == NICK.get(b, b)


sponsor_hits = collections.Counter()
sponsor_misses = []
legislators = collections.defaultdict(list)
for x in people:
    if x["chamber"] in ("state_upper", "state_lower"):
        legislators[x["state"]].append(x)
for b in load("bills*.json"):
    st = b.get("state")
    if not st or not re.match(r"https?://", b.get("url") or ""):
        continue
    for name in b.get("sponsors", []):
        # Match on the surname (which may be several words, e.g. "Bichotte Hermelyn"), then narrow by first name,
        # then by the bill's chamber. Bills list members of the other chamber too (senators signing House bills).
        full = slug(re.sub(r'\b(jr|sr|ii|iii|iv)\b\.?|"[^"]*"|,', " ", name, flags=re.I))
        if not full:
            continue
        cands = [x for x in legislators.get(st, []) if full == slug(x["last"]) or full.endswith("-" + slug(x["last"]))]
        first = full.split("-")[0]
        same_first = [x for x in cands if same_given(first, slug(x["first"]).split("-")[0]) or same_given(first, slug(x["name"]).split("-")[0])]
        if len(same_first) == 1:
            cands = same_first
        elif len(cands) > 1 and b.get("chamber") in ("upper", "lower"):
            cands = [x for x in cands if x["chamber"] == "state_" + b["chamber"]] or cands
        if len(cands) != 1:
            sponsor_misses.append(f"{st} {b.get('bill')}: {name} ({len(cands)} candidates)")
            continue  # ambiguous or not found: don't guess
        m = cands[0]
        if any(p["politician_id"] == m["id"] for p in positions):
            continue
        positions.append({"politician_id": m["id"], "policy_id": "m4a", "stance": "supports",
                          "note": f"Researched Nov 2026: sponsor or cosponsor of {b.get('bill')}, {b.get('title') or 'a state single-payer health care bill'} ({b.get('session', '')}).",
                          "source_url": b["url"], "updated_at": TODAY})
        sponsor_hits[st] += 1

out = {"generated": TODAY, "openstates_note": "Open States people data (CC0)", "people": people, "positions": positions}
(RAW / "state_officials.json").write_text(json.dumps(out))
print("people", len(people), collections.Counter((x["chamber"], x["status"]) for x in people if x["chamber"] == "governor"))
print("positions", collections.Counter(p["stance"] for p in positions), "sponsor matches by state", dict(sponsor_hits))
print("sponsors not matched (skipped):", len(sponsor_misses), *sponsor_misses, sep="\n  ")
