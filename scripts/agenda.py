#!/usr/bin/env python3
"""Agendas and health-coverage stances from the research files in data/raw/research/agenda/ (format in SCHEMA.md).

  <slug>.json / tx-*.json   one agenda or a list of agendas, keyed by politician_id. Ids that aren't on the site yet
                            (statewide officials such as the Railroad Commissioner, "TX-<office>-<name>") become new people.
  tx-medicaid-expansion.json bill authors, recorded votes, statements and federal cosponsors -> Medicaid / Medicare expansion stances

Writes data/raw/agenda_seed.json ({"people", "agenda", "positions"}), which build_seed.py merges.
Run after state_officials.py and before build_seed.py:  python3 scripts/agenda.py
"""
import collections, datetime, glob, json, pathlib, re, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DIR = RAW / "research" / "agenda"
TODAY = datetime.date.today().isoformat()
WEAK = re.compile(r"^https?://(?:www\.)?(?:ontheissues\.org|en\.wikipedia\.org|isidewith\.com)/")
URL = re.compile(r"^https?://")


def slug(s):
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()).strip()


# Everyone on the site: federal roster from the seed inputs, state officials from state_officials.py.
seed = json.load(open(ROOT / "seed" / "seed.json", encoding="utf-8"))
people = {p["id"]: p for p in seed["politicians"] if p.get("chamber") != "statewide"}  # statewide officials come from this script
for p in json.load(open(RAW / "state_officials.json", encoding="utf-8"))["people"]:
    people.setdefault(p["id"], p)
by_last = collections.defaultdict(list)
for p in people.values():
    if p.get("status") == "former":
        continue
    nm = slug(p["name"]).split()
    nm = [w for w in nm if w not in ("jr", "sr", "ii", "iii", "iv")]
    if nm:
        by_last[(p.get("state"), nm[-1])].append(p)


def find(name, st="TX", level=None, chamber=None):
    """One person by name in a state; None when missing or ambiguous."""
    name = re.sub(r"\(.*?\)|^(?:Mr|Ms|Mrs|Dr|Rep|Sen)\.?\s+|\s+of\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?$", "", name.strip())
    if "," in name:  # "Jones, Venton" / "Gonzalez, J."
        last, first = [x.strip() for x in name.split(",", 1)]
        name = f"{first} {last}"
    w = [x for x in slug(name).split() if x not in ("jr", "sr", "ii", "iii", "iv", "dr", "rep", "sen")]
    if not w:
        return None
    cands = list(by_last.get((st, w[-1]), []))
    if level:
        cands = [p for p in cands if (p.get("level") or "federal") == level]
    if chamber:
        cands = [p for p in cands if p.get("chamber") == chamber] or cands
    if len(cands) > 1 and len(w) > 1:
        first = w[0]
        cands = [p for p in cands if slug(p["name"]).split()[0] == first or slug(p.get("first")) == first
                 or (len(first) == 1 and slug(p["name"]).startswith(first)) or (len(first) > 2 and slug(p["name"]).split()[0].startswith(first[:3]))]
    if len(cands) > 1:  # prefer whoever is serving now or from January
        cands = [p for p in cands if p.get("status") != "departing"] or cands
    return cands[0] if len(cands) == 1 else None


def clean(d):
    """Drop items without a usable link; force weak sources to low confidence."""
    d = dict(d)
    for k in ("priorities", "plans", "unpopular", "polling"):
        d[k] = [x for x in d.get(k) or [] if URL.match(x.get("source_url") or "")]
        for x in d[k]:
            if WEAK.match(x["source_url"]):
                x["confidence"] = "low"
    d["timeline"] = [x for x in d.get("timeline") or [] if URL.match(x.get("url") or "")]
    return d


new_people, agenda, positions = [], [], []
ALIAS = {"TX-gov-hinojosa": "GOV-TX-gina-hinojosa"}  # ids the research used for people already on the site
done = set()
ROLE = {"railroad": "Railroad Commissioner", "lieutenant": "Lieutenant Governor", "attorney": "Attorney General", "comptroller": "Comptroller",
        "land": "Land Commissioner", "agriculture": "Agriculture Commissioner"}
for f in sorted(glob.glob(str(DIR / "*.json")), key=lambda f: (pathlib.Path(f).name.startswith("tx-"), f)):
    if f.endswith("tx-medicaid-expansion.json") or pathlib.Path(f).name.startswith("more-"):
        continue
    try:
        data = json.load(open(f, encoding="utf-8"))
    except ValueError as e:
        print("skipping", f, e)
        continue
    for a in data if isinstance(data, list) else [data]:
        pid = ALIAS.get(a.get("politician_id") or "", a.get("politician_id") or "")
        if not pid or pid in done:
            continue  # the deep-dive file for the same person wins over a lighter list entry
        done.add(pid)
        if pid not in people:
            if not pid.startswith("TX-"):
                print("unknown id", pid, a.get("name"))
                continue
            office = a.get("office") or ""
            role = next((v for k, v in ROLE.items() if k in office.lower()), office or "Statewide office")
            incoming = bool(a.get("new")) or "elect" in office.lower() or "from jan" in office.lower() or "takes office" in (a.get("summary") or "").lower()
            nm = a.get("name", "").split()
            p = {"id": pid, "name": a.get("name", ""), "first": nm[0] if nm else "", "last": nm[-1] if nm else "", "chamber": "statewide",
                 "role": role + ("-elect" if incoming else ""), "state": "TX", "party": (a.get("party") or "")[:1], "voting": 1,
                 "status": "incoming" if incoming else "current", "level": "state", "notes": "",
                 "website": (a.get("accounts") or {}).get("website") or (a.get("accounts") or {}).get("campaign_site") or "",
                 "twitter": ((a.get("accounts") or {}).get("x") or "").lstrip("@"), "bluesky": ((a.get("accounts") or {}).get("bluesky") or "").lstrip("@")}
            people[pid] = p
            new_people.append(p)
        a = clean(a)
        agenda.append({"politician_id": pid, "updated_at": TODAY, "data": {k: v for k, v in a.items() if k != "politician_id"}})
        for key, pol in (("medicaid_expansion", "medicaid_exp"), ("medicare_expansion", "medicare_exp")):
            x = (a.get("health") or {}).get(key) or {}
            if x.get("stance") in ("supports", "opposes", "unclear") and URL.match(x.get("source_url") or ""):
                stance = "unclear" if x["stance"] == "supports" and WEAK.match(x["source_url"]) else x["stance"]
                positions.append({"politician_id": pid, "policy_id": pol, "stance": stance, "note": "Researched Nov 2026: " + (x.get("note") or ""),
                                  "source_url": x["source_url"], "updated_at": TODAY})

# ---------------------------------------------------------------- add-on files (backfill): append, never replace
by_pid = {a["politician_id"]: a["data"] for a in agenda}
for f in sorted(glob.glob(str(DIR / "more-*.json"))):
    try:
        extra = json.load(open(f, encoding="utf-8"))
    except ValueError as e:
        print("skipping", f, e)
        continue
    for x in extra if isinstance(extra, list) else [extra]:
        pid = ALIAS.get(x.get("politician_id") or "", x.get("politician_id") or "")
        d = by_pid.get(pid)
        if d is None:
            print("add-on for unknown agenda", pid)
            continue
        acc_new = x.get("accounts") or {}
        x = clean({k: x.get(k) or [] for k in ("priorities", "plans", "unpopular", "polling", "timeline")})
        for k in ("timeline", "plans", "priorities"):
            link = lambda i: i.get("url") or i.get("source_url")
            seen = {(link(i), i.get("date"), i.get("text") or i.get("title")) for i in d.get(k) or []}
            # The same story on the same day counts once, even if the paraphrase differs.
            seen_day = {(link(i), i.get("date")) for i in d.get(k) or []}
            for i in x.get(k) or []:
                if (link(i), i.get("date"), i.get("text") or i.get("title")) in seen or (k == "timeline" and (link(i), i.get("date")) in seen_day):
                    continue
                d.setdefault(k, []).append(i)
                seen.add((link(i), i.get("date"), i.get("text") or i.get("title"))); seen_day.add((link(i), i.get("date")))
        acc = d.get("accounts") or {}
        for k, v in acc_new.items():
            if v and not acc.get(k):
                acc[k] = v
        d["accounts"] = acc
        d["timeline"] = sorted(d.get("timeline") or [], key=lambda t: str(t.get("date") or ""), reverse=True)

# New statewide officials take their profile links from the (possibly backfilled) accounts.
for p in new_people:
    acc = (by_pid.get(p["id"]) or {}).get("accounts") or {}
    p["twitter"] = p.get("twitter") or (acc.get("x") or "").lstrip("@")
    p["bluesky"] = p.get("bluesky") or (acc.get("bluesky") or "").lstrip("@")
    p["website"] = p.get("website") or acc.get("website") or acc.get("campaign_site") or ""

# ---------------------------------------------------------------- Medicaid / Medicare expansion evidence
have = {(p["politician_id"], p["policy_id"]) for p in positions}
unmatched = collections.Counter()


def add(p, pol, stance, note, src):
    if (p["id"], pol) in have:
        return
    have.add((p["id"], pol))
    positions.append({"politician_id": p["id"], "policy_id": pol, "stance": stance, "note": "Researched Nov 2026: " + note, "source_url": src, "updated_at": TODAY})


mx = DIR / "tx-medicaid-expansion.json"
if mx.exists():
    m = json.load(open(mx, encoding="utf-8"))
    for b in m.get("bills", []):
        if not URL.match(b.get("url") or ""):
            continue
        for name in b.get("authors", []):
            p = find(name, level="state", chamber="state_" + b["chamber"] if b.get("chamber") in ("upper", "lower") else None)
            if p:
                add(p, "medicaid_exp", "supports", f"author or coauthor of {b.get('bill')} ({b.get('session', '')}), {b.get('title') or 'to expand Medicaid'}.", b["url"])
            else:
                unmatched[name] += 1
    for v in m.get("votes", []):
        if not URL.match(v.get("url") or ""):
            continue
        for side, stance in (("yes", "supports"), ("no", "opposes")):
            for name in v.get(side, []):
                p = find(name, level="state", chamber="state_" + v["chamber"] if v.get("chamber") in ("upper", "lower") else None)
                if p:
                    add(p, "medicaid_exp", stance, f"voted {side} on {v.get('description')} ({v.get('date', '')}).", v["url"])
                else:
                    unmatched[name] += 1
    for s in m.get("statements", []):
        if s.get("stance") not in ("supports", "opposes", "unclear") or not URL.match(s.get("source_url") or ""):
            continue
        p = find(s["name"], level=s.get("level"))
        pol = "medicare_exp" if s.get("policy") == "medicare_expansion" else "medicaid_exp"
        if p:
            stance = "unclear" if s["stance"] == "supports" and WEAK.match(s["source_url"]) else s["stance"]
            add(p, pol, stance, s.get("note") or "", s["source_url"])
        else:
            unmatched[s["name"]] += 1
    for b in m.get("federal_bills", []):
        if not URL.match(b.get("url") or "") or re.search(r"(?i)medicare for all", b.get("title") or ""):
            continue
        for name in b.get("texas_cosponsors", []):
            p = find(name, level="federal")
            if p:
                add(p, "medicare_exp", "supports", f"cosponsor of {b.get('bill')}, {b.get('title')} ({b.get('congress')}th Congress).", b["url"])
            else:
                unmatched[name] += 1


# ---------------------------------------------------------------- Medicare expansion bills, all of Congress (bill text on govinfo)
# Sponsor and original cosponsors as printed in the introduced text ("Mr. Doggett (for himself, Ms. Adams, ...)").
MEDICARE_BILLS = {
    "hr2045": ("H.R. 2045", "Medicare Dental, Vision, and Hearing Benefit Act of 2025: adds dental, vision and hearing coverage to Medicare",
               "https://www.congress.gov/bill/119th-congress/house-bill/2045"),
    "hr10875": ("H.R. 10875", "Improving Medicare Coverage Act: lowers the Medicare eligibility age to 50",
                "https://www.congress.gov/bill/119th-congress/house-bill/10875"),
}
STATE_NAMES = {"Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT",
               "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
               "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI",
               "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH",
               "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
               "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
               "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"}
house119 = {t["politician_id"] for t in seed.get("terms", []) if t.get("congress") == 119 and t.get("chamber") == "house"}
reps = [people[i] for i in house119 if i in people]
missing = []
for key, (bill, title, link) in MEDICARE_BILLS.items():
    f = DIR / "bills" / f"{key}.htm"
    if not f.exists():
        continue
    import html as _html
    t = re.sub(r"\s+", " ", _html.unescape(f.read_text(errors="replace")))
    m = re.search(r"IN THE HOUSE OF REPRESENTATIVES [A-Z][a-z]+ \d+, \d{4} (.*?) introduced the following bill", t)
    if not m:
        continue
    names = re.split(r",\s*(?:and\s+)?|\s+\(for (?:himself|herself),\s*|\s+and\s+(?=M)", m.group(1).rstrip(")"))
    for raw in names:
        nm = re.sub(r"^(?:Mr|Ms|Mrs|Miss|Dr)\.\s*", "", raw.strip().rstrip(")"))
        if not nm or nm.startswith("for "):
            continue
        st = None
        mm = re.match(r"(.+?) of ([A-Z][a-z]+(?: [A-Z][a-z]+)?)$", nm)
        if mm:
            nm, st = mm.group(1), STATE_NAMES.get(mm.group(2))
        key_ = slug(nm)
        hits = [p for p in reps if (not st or p.get("state") == st) and (slug(p["name"]).endswith(" " + key_) or slug(p["name"]) == key_ or slug(p.get("last")) == key_)]
        if len(hits) > 1:
            hits = [p for p in hits if slug(p.get("last")) == key_] or [p for p in hits if slug(p["name"]).split()[-len(key_.split()) - 1:-len(key_.split())] != []
                                                                       and slug(p["name"]).split()[-len(key_.split()):] == key_.split() and "-" not in p["name"]] or hits
        if len(hits) == 1:
            add(hits[0], "medicare_exp", "supports", f"sponsor or original cosponsor of {bill}, {title}.", link)
        else:
            missing.append(raw.strip())
if missing:
    print("Medicare-bill names not matched:", missing)

(RAW / "agenda_seed.json").write_text(json.dumps({"generated": TODAY, "people": new_people, "agenda": agenda, "positions": positions}))
print("agendas", len(agenda), "new people", [p["name"] + " (" + p["role"] + ")" for p in new_people])
print("positions", collections.Counter((p["policy_id"], p["stance"]) for p in positions))
if unmatched:
    print("unmatched names", dict(unmatched.most_common(40)))
