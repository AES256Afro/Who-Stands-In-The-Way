#!/usr/bin/env python3
"""Builds seed/seed.json (the baseline the site loads on first run) from the
raw public datasets in data/raw/. Re-run after refreshing the raw files.

Sources (all free, no API key except congress.gov DEMO_KEY):
  - unitedstates/congress-legislators  -> current members + official socials
  - Wikidata                           -> additional X/Twitter, Bluesky handles
  - api.congress.gov                   -> sponsors/cosponsors of H.R.3069 / S.1506
  - FEC bulk data, 2025-26 cycle       -> candidate totals, PAC gifts, outside spending
"""
import csv, json, re, collections, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "seed"
OUT.mkdir(exist_ok=True)
TODAY = datetime.date.today().isoformat()
NONVOTING = {"DC", "PR", "GU", "VI", "AS", "MP"}


def load(name):
    return json.load(open(RAW / name, encoding="utf-8"))


# ---------------------------------------------------------------- people
legis = load("legislators-current.json")
social = {s["id"]["bioguide"]: s["social"] for s in load("legislators-social-media.json")}

wd_tw = collections.defaultdict(set)
wd_bsky = {}
for b in load("wd.json")["results"]["bindings"]:
    bio = b["bio"]["value"]
    if "tw" in b and "end" not in b:
        wd_tw[bio].add(b["tw"]["value"])
    if "bsky" in b:
        wd_bsky[bio] = b["bsky"]["value"]

# ---------------------------------------------------------------- M4A bills
BILLS = {"rep": ("hr_3069", "H.R.3069", "https://www.congress.gov/bill/119th-congress/house-bill/3069"),
         "sen": ("s_1506", "S.1506", "https://www.congress.gov/bill/119th-congress/senate-bill/1506")}
support = {}  # bioguide -> (note, url)
for chamber, (key, label, url) in BILLS.items():
    bill = load(f"bill_{key}.json")["bill"]
    for s in bill["sponsors"]:
        support[s["bioguideId"]] = (f"Lead sponsor of {label}, Medicare for All Act (119th Congress).", url)
    for c in load(f"cos_{key}.json")["cosponsors"]:
        if c.get("sponsorshipWithdrawnDate"):
            continue
        orig = "Original cosponsor" if c.get("isOriginalCosponsor") else "Cosponsor"
        support[c["bioguideId"]] = (
            f"{orig} of {label}, Medicare for All Act (119th Congress), signed on {c.get('sponsorshipDate', 'n/a')}.", url)

# ---------------------------------------------------------------- FEC
W = ["CAND_ID", "CAND_NAME", "CAND_ICI", "PTY_CD", "CAND_PTY_AFFILIATION", "TTL_RECEIPTS", "TRANS_FROM_AUTH",
     "TTL_DISB", "TRANS_TO_AUTH", "COH_BOP", "COH_COP", "CAND_CONTRIB", "CAND_LOANS", "OTHER_LOANS",
     "CAND_LOAN_REPAY", "OTHER_LOAN_REPAY", "DEBTS_OWED_BY", "TTL_INDIV_CONTRIB", "CAND_OFFICE_ST",
     "CAND_OFFICE_DISTRICT", "SPEC_ELECTION", "PRIM_ELECTION", "RUN_ELECTION", "GEN_ELECTION",
     "GEN_ELECTION_PRECENT", "OTHER_POL_CMTE_CONTRIB", "POL_PTY_CONTRIB", "CVG_END_DT", "INDIV_REFUNDS",
     "CMTE_REFUNDS"]
weball = {}
for line in open(RAW / "weball26.txt", encoding="latin-1"):
    f = line.rstrip("\n").split("|")
    weball[f[0]] = dict(zip(W, f))

cm = {}
for line in open(RAW / "cm.txt", encoding="latin-1"):
    f = line.rstrip("\n").split("|")
    cm[f[0]] = {"name": f[1], "dsgn": f[8], "tp": f[9], "org_tp": f[12], "org": f[13]}

SUPER_TP = {"O": "Super PAC", "U": "Single-candidate super PAC", "V": "Hybrid PAC", "W": "Hybrid PAC",
            "N": "PAC", "Q": "PAC", "X": "Party committee", "Y": "Party committee", "Z": "Party committee",
            "I": "Independent spender", "E": "Electioneering", "C": "Communication cost"}

SECTORS = [
    ("insurance", re.compile(
        r"UNITEDHEALTH|UNITED HEALTH GROUP|ELEVANCE|\bANTHEM\b|\bCIGNA\b|HUMANA|\bAETNA\b|CVS HEALTH|CENTENE|"
        r"MOLINA|BLUE ?CROSS|BLUE ?SHIELD|HEALTH INSURANCE PLANS|\bAHIP\b|HEALTH CARE SERVICE CORP|HIGHMARK|"
        r"KAISER FOUNDATION HEALTH|WELLCARE|OSCAR HEALTH|EXPRESS SCRIPTS|PHARMACEUTICAL CARE MANAGEMENT|"
        r"HEALTH PLAN|GUIDEWELL|CAREFIRST|CAMBIA HEALTH|HEALTH UNDERWRITERS|BENEFITS? ADVISORS")),
    ("pharma", re.compile(
        r"PFIZER|\bMERCK\b|ABBVIE|\bAMGEN\b|ELI LILLY|LILLY AND COMPANY|JOHNSON & JOHNSON|JOHNSON AND JOHNSON|"
        r"BRISTOL[- ]MYERS|NOVARTIS|SANOFI|GLAXOSMITHKLINE|\bGSK\b|ASTRAZENECA|GILEAD|NOVO NORDISK|\bBAYER\b|"
        r"TAKEDA|REGENERON|VERTEX PHARM|BIOGEN|\bTEVA\b|PHARMACEUTIC|PHARMA\b|BIOPHARM|"
        r"BIOTECHNOLOGY INNOVATION|GENENTECH|BOEHRINGER|ASTELLAS|OTSUKA|VIATRIS|MODERNA|DAIICHI|\bEISAI\b|"
        r"ABBOTT LAB|ALKERMES|EMD SERONO|LUNDBECK|MALLINCKRODT|\bROCHE\b|MCKESSON|CARDINAL HEALTH|CENCORA|"
        r"AMERISOURCEBERGEN")),
    ("hospitals", re.compile(
        r"HOSPITAL|\bHCA\b|TENET HEALTH|COMMUNITY HEALTH SYSTEMS|UNIVERSAL HEALTH SERVICES|HEALTH SYSTEM")),
]
NOT_HEALTH = re.compile(r"VETERINAR|ANIMAL|PET ")


def sector(cid, fallback_name=""):
    c = cm.get(cid, {})
    text = f"{c.get('name', fallback_name)} {c.get('org', '')}".upper()
    if NOT_HEALTH.search(text):
        return None
    for name, rx in SECTORS:
        if rx.search(text):
            return name
    return None


def num(x):
    try:
        return float(x or 0)
    except ValueError:
        return 0.0


# PAC -> candidate contributions (24K direct, 24Z in-kind)
pac = collections.defaultdict(lambda: collections.defaultdict(float))
for line in open(RAW / "itpas2.txt", encoding="latin-1"):
    f = line.rstrip("\n").split("|")
    if len(f) < 17 or f[5] not in ("24K", "24Z") or not f[16]:
        continue
    pac[f[16]][f[0]] += num(f[14])

# Independent expenditures (outside spending). Keep latest filing per transaction.
ie_latest = {}
with open(RAW / "independent_expenditure_2026.csv", encoding="latin-1", newline="") as fh:
    for r in csv.DictReader(fh):
        if not r["cand_id"]:
            continue
        k = (r["spe_id"], r["tran_id"])
        if k not in ie_latest or int(r["file_num"] or 0) >= int(ie_latest[k]["file_num"] or 0):
            ie_latest[k] = r
ie = collections.defaultdict(lambda: collections.defaultdict(lambda: {"S": 0.0, "O": 0.0, "name": ""}))
for r in ie_latest.values():
    so = (r["sup_opp"] or "").upper()[:1]
    if so not in ("S", "O"):
        continue
    e = ie[r["cand_id"]][r["spe_id"]]
    e[so] += num(r["exp_amo"])
    e["name"] = r["spe_nam"]


def finance_for(fec_ids, opensecrets):
    rows = [weball[i] for i in fec_ids if i in weball]
    rows = [r for r in rows if num(r["TTL_RECEIPTS"]) or num(r["TTL_DISB"]) or num(r["COH_COP"])]
    out = {"cycle": "2025-26", "fec_ids": fec_ids, "has_data": bool(rows)}
    if rows:
        s = lambda k: round(sum(num(r[k]) for r in rows), 2)
        out["totals"] = {
            "receipts": s("TTL_RECEIPTS"), "individuals": s("TTL_INDIV_CONTRIB"),
            "pacs": s("OTHER_POL_CMTE_CONTRIB"), "party": s("POL_PTY_CONTRIB"),
            "self": round(s("CAND_CONTRIB") + s("CAND_LOANS"), 2), "cash_on_hand": s("COH_COP"),
            "through": max((r["CVG_END_DT"] for r in rows), key=lambda d: d[-4:] + d[:5] if d else ""),
        }
    # PAC gifts
    gifts = collections.defaultdict(float)
    for i in fec_ids:
        for cid, amt in pac.get(i, {}).items():
            gifts[cid] += amt
    items = []
    for cid, amt in gifts.items():
        if amt <= 0:
            continue
        c = cm.get(cid, {})
        items.append({"id": cid, "name": c.get("name") or cid, "org": c.get("org") or "",
                      "amount": round(amt, 2), "sector": sector(cid)})
    items.sort(key=lambda x: -x["amount"])
    sectors = collections.defaultdict(float)
    for it in items:
        if it["sector"]:
            sectors[it["sector"]] += it["amount"]
    out["pac_count"] = len(items)
    out["pac_itemized_total"] = round(sum(i["amount"] for i in items), 2)
    out["health_sectors"] = {k: round(v, 2) for k, v in sectors.items()}
    out["health_total"] = round(sum(sectors.values()), 2)
    out["health_pacs"] = [i for i in items if i["sector"]][:40]
    out["top_pacs"] = items[:15]
    # Outside spending
    spend = {}
    for i in fec_ids:
        for sid, e in ie.get(i, {}).items():
            t = spend.setdefault(sid, {"id": sid, "name": e["name"], "support": 0.0, "oppose": 0.0})
            t["support"] += e["S"]
            t["oppose"] += e["O"]
    sp = []
    for t in spend.values():
        t["support"], t["oppose"] = round(t["support"], 2), round(t["oppose"], 2)
        t["type"] = SUPER_TP.get(cm.get(t["id"], {}).get("tp", ""), "Outside group")
        t["sector"] = sector(t["id"], t["name"])
        sp.append(t)
    sp.sort(key=lambda x: -(x["support"] + x["oppose"]))
    out["outside"] = {"support": round(sum(t["support"] for t in sp), 2),
                      "oppose": round(sum(t["oppose"] for t in sp), 2),
                      "count": len(sp), "top": sp[:12]}
    return out


# ---------------------------------------------------------------- assemble
PARTY = {"Democrat": "D", "Republican": "R", "Independent": "I"}
politicians, positions, finance = [], [], []
for m in legis:
    t = m["terms"][-1]
    ids = m["id"]
    bio = ids["bioguide"]
    s = social.get(bio, {})
    official_tw = s.get("twitter", "")
    alts = sorted(h for h in wd_tw.get(bio, ()) if h.lower() != official_tw.lower())
    yt = s.get("youtube")
    youtube = f"https://www.youtube.com/{yt}" if yt else (
        f"https://www.youtube.com/channel/{s['youtube_id']}" if s.get("youtube_id") else "")
    chamber = "senate" if t["type"] == "sen" else "house"
    name = m["name"].get("official_full") or f"{m['name']['first']} {m['name']['last']}"
    politicians.append({
        "id": bio, "name": name, "first": m["name"]["first"], "last": m["name"]["last"],
        "chamber": chamber, "role": "Senator" if chamber == "senate" else (
            "Delegate" if t["state"] in NONVOTING else "Representative"),
        "state": t["state"], "district": t.get("district"), "party": PARTY.get(t["party"], t["party"][:1]),
        "caucus": t.get("caucus", ""), "voting": 0 if (chamber == "house" and t["state"] in NONVOTING) else 1,
        "status": "current", "term_start": t["start"], "term_end": t["end"],
        "website": t.get("url", ""), "contact_form": t.get("contact_form", ""),
        "phone": t.get("phone", ""), "office": t.get("office", t.get("address", "")),
        "twitter": official_tw, "twitter_alt": ", ".join(alts), "facebook": s.get("facebook", ""),
        "instagram": s.get("instagram", ""), "youtube": youtube, "bluesky": wd_bsky.get(bio, ""),
        "mastodon": s.get("mastodon", ""), "opensecrets_id": ids.get("opensecrets", ""),
        "fec_ids": ", ".join(ids.get("fec", [])), "govtrack_id": ids.get("govtrack"),
        "wikipedia": ids.get("wikipedia", ""), "ballotpedia": ids.get("ballotpedia", ""),
        "photo_url": f"https://unitedstates.github.io/images/congress/225x275/{bio}.jpg", "notes": "",
    })
    if bio in support:
        note, url = support[bio]
        positions.append({"politician_id": bio, "policy_id": "m4a", "stance": "supports",
                          "note": note, "source_url": url, "updated_at": TODAY})
    finance.append({"politician_id": bio, "as_of": TODAY,
                    "data": finance_for(ids.get("fec", []), ids.get("opensecrets", ""))})

EXEC = [("EXEC-POTUS", "Donald J. Trump", "Donald", "Trump", "President", "https://www.whitehouse.gov/",
         "POTUS", "realDonaldTrump", "Can sign or veto the bill."),
        ("EXEC-VPOTUS", "JD Vance", "JD", "Vance", "Vice President", "https://www.whitehouse.gov/",
         "VP", "JDVance", "Casts the tie-breaking vote in the Senate.")]
for pid, name, first, last, role, site, tw, alt, note in EXEC:
    politicians.append({
        "id": pid, "name": name, "first": first, "last": last, "chamber": "executive", "role": role,
        "state": "US", "district": None, "party": "R", "caucus": "", "voting": 0, "status": "current",
        "term_start": "2025-01-20", "term_end": "2029-01-20", "website": site, "contact_form": "",
        "phone": "", "office": "", "twitter": tw, "twitter_alt": alt, "facebook": "", "instagram": "",
        "youtube": "", "bluesky": "", "mastodon": "", "opensecrets_id": "", "fec_ids": "",
        "govtrack_id": None, "wikipedia": name, "ballotpedia": "", "photo_url": "", "notes": note})

policies = [
    {"id": "m4a", "name": "Medicare for All", "is_primary": 1, "sort": 0,
     "description": "Single-payer national health insurance: the Medicare for All Act "
                    "(H.R.3069 / S.1506, 119th Congress). A public option does not count as support.",
     "bill_house": "H.R.3069", "bill_senate": "S.1506",
     "url": "https://www.congress.gov/bill/119th-congress/house-bill/3069"},
]
outlets = [{"name": n, "kind": k, "website": w, "logo_url": "", "contact_url": "", "notes": ""} for n, k, w in [
    ("CNN", "TV / cable news", "https://www.cnn.com"), ("MSNBC", "TV / cable news", "https://www.msnbc.com"),
    ("Fox News", "TV / cable news", "https://www.foxnews.com"), ("C-SPAN", "TV / cable news", "https://www.c-span.org"),
    ("NBC Meet the Press", "TV / Sunday show", "https://www.nbcnews.com/meet-the-press"),
    ("CBS Face the Nation", "TV / Sunday show", "https://www.cbsnews.com/face-the-nation/"),
    ("ABC This Week", "TV / Sunday show", "https://abcnews.go.com/ThisWeek"),
    ("NPR", "Radio", "https://www.npr.org"), ("Town hall", "In person", ""),
    ("Floor speech", "Congress", "https://www.congress.gov"),
    ("X / Twitter post", "Social media", "https://x.com"), ("Press release", "Statement", "")]]

seed = {"generated": TODAY, "politicians": politicians, "positions": positions, "policies": policies,
        "outlets": outlets, "finance": finance}
(OUT / "seed.json").write_text(json.dumps(seed, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

# ---------------------------------------------------------------- report
c = collections.Counter((p["chamber"], p["voting"]) for p in politicians)
sup = collections.Counter(next(p["chamber"] for p in politicians if p["id"] == x["politician_id"]) for x in positions)
print("politicians", len(politicians), dict(c))
print("M4A supporters", dict(sup), "unmatched cosponsors:", sorted(set(support) - {p['id'] for p in politicians}))
print("with twitter", sum(1 for p in politicians if p["twitter"]), "alt", sum(1 for p in politicians if p["twitter_alt"]),
      "bluesky", sum(1 for p in politicians if p["bluesky"]), "website", sum(1 for p in politicians if p["website"]))
fd = [f["data"] for f in finance]
print("finance has_data", sum(1 for f in fd if f["has_data"]), "with PAC gifts", sum(1 for f in fd if f["pac_count"]),
      "with health PACs", sum(1 for f in fd if f["health_total"] > 0), "with outside", sum(1 for f in fd if f["outside"]["count"]))
print("seed bytes", (OUT / "seed.json").stat().st_size)
