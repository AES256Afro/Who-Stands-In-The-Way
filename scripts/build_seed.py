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
    ("devices", re.compile(
        r"MEDTRONIC|ADVAMED|ADVANCED MEDICAL TECHNOLOGY|BOSTON SCIENTIFIC|STRYKER|BECTON|BAXTER|ZIMMER|"
        r"INTUITIVE SURGICAL|EDWARDS LIFESCIENCES|HOLOGIC|GE HEALTHCARE|SIEMENS HEALTHINEERS|DEXCOM|RESMED|"
        r"SMITH (?:&|AND) NEPHEW|MEDICAL DEVICE|MEDICAL IMAGING|DIAGNOSTIC")),
    ("providers", re.compile(
        r"DAVITA|FRESENIUS|DIALYSIS|LABCORP|LABORATORY CORP|QUEST DIAGNOSTICS|CLINICAL LABORATORY|"
        r"AMERICAN HEALTH CARE ASSOCIATION|NURSING HOME|LONG.TERM CARE|HOME CARE|HOME HEALTH|HOSPICE|"
        r"ENVISION|TEAMHEALTH|SURGERY CENTER|AMBULATORY SURGERY|ASSISTED LIVING")),
    ("doctors", re.compile(
        r"AMERICAN MEDICAL ASSOCIATION|MEDICAL ASSOCIATION|MEDICAL SOCIETY|PHYSICIANS|ANESTHESIOLOGISTS|RADIOLOG|"
        r"COLLEGE OF SURGEONS|ORTHOPAEDIC|ORTHOPEDIC|DERMATOLOG|CARDIOLOG|UROLOG|OPHTHALMOLOG|ONCOLOG|"
        r"GASTROENTEROLOG|NEUROLOG|PATHOLOG|MEDICAL GROUP MANAGEMENT|DENTAL ASSOCIATION|OPTOMETRIC|"
        r"CHIROPRACTIC|PODIATRIC|OSTEOPATHIC")),
    ("hospitals", re.compile(
        r"HOSPITAL|\bHCA\b|TENET HEALTH|COMMUNITY HEALTH SYSTEMS|UNIVERSAL HEALTH SERVICES|HEALTH SYSTEM")),
]
NOT_HEALTH = re.compile(r"VETERINAR|ANIMAL|PET |NURSE|UNION|WORKERS|SEIU|AFL-CIO|TEAMSTERS")  # nurses and unions back M4A


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


# Leadership PACs: the member's second fund. Committee gifts to it come from scripts/leadership_pacs.py.
lpac_by_cand = collections.defaultdict(list)
_lp = RAW / "lpac_agg.json"
if _lp.exists():
    for lid, v in json.load(open(_lp)).items():
        for cand in v["sponsors"]:
            lpac_by_cand[cand].append((lid, v))


# Donations from health-industry employees (scripts/employee_donations.py): totals by employer, no names.
emp_by_cmte, cmtes_of_cand = {}, collections.defaultdict(list)
_ea = RAW / "emp_agg.json"
if _ea.exists():
    _e = json.load(open(_ea))
    emp_by_cmte = _e["by_committee"]
    for cmte, cand in _e["candidate_of"].items():
        cmtes_of_cand[cand].append(cmte)


def employees_for(cmtes):
    merged = collections.defaultdict(lambda: {"amount": 0.0, "count": 0, "sector": ""})
    for c in cmtes:
        for r in emp_by_cmte.get(c, []):
            m = merged[r["employer"]]
            m["amount"] += r["amount"]
            m["count"] += r["count"]
            m["sector"] = r["sector"]
    rows = sorted(({"employer": k, **v, "amount": round(v["amount"], 2)} for k, v in merged.items()), key=lambda r: -r["amount"])
    sec = collections.defaultdict(float)
    for r in rows:
        sec[r["sector"]] += r["amount"]
    return {"total": round(sum(sec.values()), 2), "sectors": {k: round(v, 2) for k, v in sec.items()},
            "donations": sum(r["count"] for r in rows), "top": rows[:20]}


def leadership_for(fec_ids):
    out, seen = [], set()
    for i in fec_ids:
        for lid, v in lpac_by_cand.get(i, []):
            if lid in seen:
                continue
            seen.add(lid)
            items = [{"id": d, "name": cm.get(d, {}).get("name") or d, "amount": a, "sector": sector(d)}
                     for d, a in v["gifts"].items()]
            items.sort(key=lambda x: -x["amount"])
            sec = collections.defaultdict(float)
            for it in items:
                if it["sector"]:
                    sec[it["sector"]] += it["amount"]
            out.append({"id": lid, "name": v["name"], "employees": employees_for([lid]), "total": round(sum(x["amount"] for x in items), 2),
                        "count": len(items), "health_total": round(sum(sec.values()), 2),
                        "health_sectors": {k: round(x, 2) for k, x in sec.items()},
                        "health": [x for x in items if x["sector"]][:25], "top": items[:12]})
    return out


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
    out["leadership"] = leadership_for(fec_ids)
    out["employees"] = employees_for([c for i in fec_ids for c in cmtes_of_cand.get(i, [])])
    return out


# ---------------------------------------------------------------- assemble (120th Congress roster)
import glob, sys, unicodedata, urllib.parse
sys.path.insert(0, str(ROOT / "scripts"))
import roster120

roster = roster120.parse(RAW / "wp_120th.json")
ROSTER_REV = roster120.revid(RAW / "wp_120th.json")
wd120 = load("wd_120.json")
cur = {m["id"]["bioguide"]: m for m in legis}
hist_list = load("legislators-historical.json")
hist = {m["id"]["bioguide"]: m for m in hist_list}
by_wiki = {m["id"]["wikipedia"]: m["id"]["bioguide"] for m in hist_list + legis if m["id"].get("wikipedia")}

research = {}
for f in sorted(glob.glob(str(RAW / "research" / "result*.json"))):
    try:
        for r in json.load(open(f, encoding="utf-8")):
            if r.get("wiki"):
                research[r["wiki"]] = r
    except ValueError as e:
        print("skipping unreadable research file", f, e)


def norm(x):
    x = unicodedata.normalize("NFKD", x).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z ]", " ", x).split()


SUFFIX = {"JR", "SR", "II", "III", "IV"}
fec_index = collections.defaultdict(list)  # (office letter, state) -> rows
for cid, r in weball.items():
    fec_index[(cid[0], r["CAND_OFFICE_ST"])].append(r)


def fec_by_name(name, chamber, state):
    toks = [t for t in norm(name) if t not in SUFFIX]
    if not toks:
        return []
    last, first = toks[-1], toks[0]
    cands = []
    for r in fec_index.get(("S" if chamber == "senate" else "H", state), []):
        ln, _, fn = r["CAND_NAME"].partition(",")
        if last in norm(ln):
            cands.append((first[:3] in [t[:3] for t in norm(fn)], num(r["TTL_RECEIPTS"]), r["CAND_ID"]))
    exact = [c for c in cands if c[0]]
    pool = exact or (cands if len(cands) == 1 else [])
    return [max(pool, key=lambda c: c[1])[2]] if pool else []


# ---------------------------------------------------------------- contact + committees + earlier M4A bills
district_offices = {}
for m in load("legislators-district-offices.json"):
    offs = []
    for o in m.get("offices", []):
        addr = ", ".join(str(x) for x in [o.get("address"), o.get("suite"), o.get("building")] if x)
        offs.append({"city": o.get("city", ""), "state": o.get("state", ""), "address": addr,
                     "zip": str(o.get("zip") or ""), "phone": o.get("phone") or "", "fax": o.get("fax") or ""})
    district_offices[m["id"]["bioguide"]] = sorted(offs, key=lambda x: x["city"])

committee_names, HEALTH_CMTE = {}, {"HSIF", "HSWM", "SSHR", "SSFI"}
for c in load("committees-current.json"):
    committee_names[c["thomas_id"]] = c["name"]
    for sub in c.get("subcommittees", []):
        committee_names[c["thomas_id"] + sub["thomas_id"]] = f"{c['name']}: {sub['name']}"
member_committees = collections.defaultdict(list)
for cid, members in load("committee-membership-current.json").items():
    name = committee_names.get(cid)
    if not name:
        continue
    health = cid in HEALTH_CMTE or (len(cid) > 4 and "Health" in name.split(":", 1)[-1])
    for mem in members:
        member_committees[mem["bioguide"]].append({"id": cid, "name": name, "title": mem.get("title", ""),
                                                   "health": int(bool(health)), "sub": int(len(cid) > 4)})
for v in member_committees.values():
    v.sort(key=lambda x: (x["id"][:4], x["sub"], x["name"]))

past_bills = {}
_pb = RAW / "m4a_past_bills.json"
if _pb.exists():
    for k, b in json.load(open(_pb)).items():
        if "Medicare for All" not in (b.get("title") or ""):
            continue
        cg, typ, num_ = k.split("-")
        label = f"{'H.R.' if typ == 'hr' else 'S.'}{num_} ({cg}th Congress)"
        for sid in b["sponsors"] + [c["id"] for c in b["cosponsors"] if not c["withdrawn"]]:
            past_bills.setdefault(sid, []).append(label)

sweep = {}
# Later passes override earlier ones for the same person.
for f in sorted(glob.glob(str(RAW / "research" / "sweep" / "result*.json"))) + [str(RAW / "research" / "sweep2" / "results.json")]:
    if not pathlib.Path(f).exists():
        continue
    try:
        for r_ in json.load(open(f, encoding="utf-8")):
            sweep[r_["id"]] = r_
    except ValueError as e:
        print("skipping unreadable sweep file", f, e)
SWITCHBOARD = "202-224-3121"


def contact(bio, name, has_phone):
    return {"offices": json.dumps(district_offices.get(bio, [])),
            "committees": json.dumps(member_committees.get(bio, [])),
            "phone_label": "" if has_phone else f"U.S. Capitol switchboard: ask for {name}'s office. Their direct line is assigned after Jan 3, 2027."}


# Sources that often summarize or infer positions (e.g. from interest-group scores) rather than quote the person.
WEAK_SOURCES = re.compile(r"^https?://(?:www\.)?(?:ontheissues\.org|en\.wikipedia\.org|isidewith\.com)/", re.I)


def researched(pid, rs):
    if rs.get("stance") in ("supports", "public_option", "unclear", "opposes") and re.match(r"https?://", rs.get("source_url") or ""):
        conf = "low" if WEAK_SOURCES.match(rs["source_url"]) else rs.get("confidence")
        stance, note = rs["stance"], (rs.get("note") or "").strip()
        if stance == "supports" and conf == "low":  # don't let thin evidence inflate the supporter count
            stance, note = "unclear", "Reported as a supporter, but not confirmed in their own words: " + note
        low = " Low confidence: verify before citing." if conf == "low" else ""
        return {"politician_id": pid, "policy_id": "m4a", "stance": stance,
                "note": "Researched Nov 2026: " + note + low,
                "source_url": rs["source_url"], "updated_at": TODAY}
    return None


TERM_END = {1: "2031-01-03", 2: "2033-01-03", 3: "2029-01-03"}
NEXT_ELECTION = {1: "2030-11-05", 2: "2032-11-02", 3: "2028-11-07"}
PARTY = {"Democrat": "D", "Republican": "R", "Independent": "I"}
politicians, positions, finance, undecided, terms = [], [], [], [], []
seat_pid = {}

# Voting-record ideology (Voteview DW-NOMINATE, first dimension: -1 left ... +1 right), 119th Congress.
nominate = {}
for fn in ("H119_members.csv", "S119_members.csv"):
    with open(RAW / fn, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if row["bioguide_id"] and row["nominate_dim1"]:
                nominate[row["bioguide_id"]] = float(row["nominate_dim1"])
LEAN_CUTS = [(-0.5, "left3"), (-0.3, "left2"), (-0.1, "left1"), (0.1, "center"), (0.35, "right1"), (0.6, "right2")]


def lean_for(bio):
    x = nominate.get(bio)
    if x is None:
        return {"lean": "unknown", "ideology": None, "lean_note": ""}
    lean = next((v for cut, v in LEAN_CUTS if x <= cut), "right3")
    return {"lean": lean, "ideology": round(x, 3),
            "lean_note": f"From voting record in the 119th Congress (Voteview DW-NOMINATE score {x:+.2f} on a -1 left to +1 right scale)."}


kinds = collections.Counter()
for r in roster:
    if r["undecided"]:
        undecided.append(f"{r['state']}-{r['district'] or 'AL'}")
        continue
    w = wd120.get(r["wiki"], {})
    rs = research.get(r["wiki"], {})
    bio = (w.get("bioguide") or [None])[0] or by_wiki.get(r["wiki"])
    m = cur.get(bio) or hist.get(bio)
    kind = "returning" if bio in cur else ("comeback" if m else "new")
    kinds[kind] += 1
    pid = bio if m else "N-" + re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", r["name"]).encode("ascii", "ignore").decode().lower()).strip("-") + "-" + r["state"].lower()
    ids = m["id"] if m else {}
    t = m["terms"][-1] if m else {}
    chamber = r["chamber"]
    same_seat = kind == "returning" and ((t.get("type") == "sen") == (chamber == "senate"))
    s = social.get(bio, {}) if kind == "returning" else {}
    wtw = w.get("twitter", [])
    official_tw = s.get("twitter") or (wtw[0] if wtw else "")  # researched handles are unverified: "other X" only
    alts = sorted({h for h in list(wd_tw.get(bio, ())) + wtw + [rs.get("twitter", "")] if h and h.lower() != official_tw.lower()})
    yt = s.get("youtube")
    youtube = f"https://www.youtube.com/{yt}" if yt else (
        f"https://www.youtube.com/channel/{s['youtube_id']}" if s.get("youtube_id") else (
            f"https://www.youtube.com/channel/{w['youtube_id'][0]}" if w.get("youtube_id") else ""))
    name = r["name"]
    toks = name.split()
    last_i = len(toks) - 1 - (1 if norm(toks[-1]) and norm(toks[-1])[0] in SUFFIX and len(toks) > 2 else 0)
    first, last = (m["name"]["first"], m["name"]["last"]) if m else (toks[0], toks[last_i])
    klass = r.get("class")
    fec_ids = list(dict.fromkeys(ids.get("fec", []) + w.get("fec", [])))
    if not any(i in weball for i in fec_ids):
        fec_ids += [i for i in fec_by_name(name, chamber, r["state"]) if i not in fec_ids]
    website = (t.get("url", "") if same_seat else "") or rs.get("campaign_website", "") or (w.get("website") or [""])[0] or t.get("url", "")
    if website and not website.startswith("http") and "." in website:
        website = "https://" + website
    if website and not re.match(r"https?://", website):
        website = ""
    photo = (f"https://unitedstates.github.io/images/congress/225x275/{bio}.jpg" if m else "") or (
        "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(w["image"][0].replace(" ", "_")) + "?width=300" if w.get("image") else "")
    if kind != "returning" and w.get("image"):
        photo = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(w["image"][0].replace(" ", "_")) + "?width=300"
    notes = []
    if kind == "new":
        notes.append("Newly elected in November 2026; takes office January 3, 2027.")
    if kind == "comeback":
        notes.append("Former member of Congress returning in January 2027.")
    if kind == "returning" and not same_seat:
        notes.append("Moving from the House to the Senate in January 2027." if chamber == "senate" else "Moving chambers in January 2027.")
    if r["outgoing"]:
        notes.append("Listed as outgoing: expected to leave this seat early in 2027, so a successor will follow.")
    seat = r.get("district") or 0 if chamber == "house" else ("special" if (klass == 3 and r["state"] in ("FL", "OH")) else klass)
    seat_pid[(chamber, r["state"], seat)] = pid
    terms.append({"politician_id": pid, "congress": 120, "chamber": chamber, "state": r["state"],
                  "district": r.get("district") or None, "party": r["party"], "voting": r["voting"],
                  "role": "Senator" if chamber == "senate" else ("Representative" if r["voting"] else "Delegate")})
    politicians.append({**lean_for(bio),
        "id": pid, "name": name, "first": first, "last": last, "chamber": chamber,
        "role": "Senator" if chamber == "senate" else ("Representative" if r["voting"] else "Delegate"),
        "state": r["state"], "district": r.get("district") or None, "party": r["party"],
        "caucus": t.get("caucus", "") if kind == "returning" else "", "voting": r["voting"],
        "status": "current" if kind == "returning" else "incoming",
        "term_start": t.get("start", "") if (chamber == "senate" and klass != 2 and same_seat) else "2027-01-03",
        "term_end": TERM_END[klass] if chamber == "senate" else "2029-01-03",
        "next_election": NEXT_ELECTION[klass] if chamber == "senate" else "2028-11-07",
        "website": website, "contact_form": t.get("contact_form", "") if same_seat else "",
        "phone": (t.get("phone", "") if same_seat else "") or SWITCHBOARD,
        **contact(bio, name, bool(t.get("phone") and same_seat)),
        "office": t.get("office", t.get("address", "")) if same_seat else "",
        "twitter": official_tw, "twitter_alt": ", ".join(alts),
        "facebook": s.get("facebook", "") or (w.get("facebook") or [""])[0],
        "instagram": s.get("instagram", "") or (w.get("instagram") or [""])[0], "youtube": youtube,
        "bluesky": wd_bsky.get(bio, "") or (w.get("bluesky") or [""])[0], "mastodon": s.get("mastodon", ""),
        "opensecrets_id": ids.get("opensecrets", "") or (w.get("opensecrets") or [""])[0],
        "fec_ids": ", ".join(fec_ids), "govtrack_id": ids.get("govtrack"),
        "wikipedia": r["wiki"], "ballotpedia": ids.get("ballotpedia", ""), "photo_url": photo,
        "notes": " ".join(notes),
    })
    if kind == "returning" and bio in support:
        note, url = support[bio]
        positions.append({"politician_id": pid, "policy_id": "m4a", "stance": "supports",
                          "note": note + " The bill has to be reintroduced in the new Congress.",
                          "source_url": url, "updated_at": TODAY})
    elif bio in past_bills:
        bills = ", ".join(past_bills[bio])
        if kind == "returning":
            positions.append({"politician_id": pid, "policy_id": "m4a", "stance": "unclear",
                              "note": f"Researched Nov 2026: cosponsored the Medicare for All Act before ({bills}) but has not signed on to the current bill (H.R.3069 / S.1506).",
                              "source_url": "https://www.congress.gov/bill/119th-congress/house-bill/3069/cosponsors", "updated_at": TODAY})
        else:
            positions.append({"politician_id": pid, "policy_id": "m4a", "stance": "supports",
                              "note": f"Researched Nov 2026: cosponsored the Medicare for All Act during an earlier stint in Congress ({bills}).",
                              "source_url": "https://www.congress.gov/bill/117th-congress/house-bill/1976/cosponsors", "updated_at": TODAY})
    elif kind != "returning" and researched(pid, rs):
        positions.append(researched(pid, rs))
    elif researched(pid, sweep.get(pid, {})):
        positions.append(researched(pid, sweep[pid]))
    finance.append({"politician_id": pid, "as_of": TODAY, "data": finance_for(fec_ids, "")})

# ---------------------------------------------------------------- 119th Congress (current, until Jan 3 2027)
NONVOTE = {"DC", "PR", "GU", "VI", "AS", "MP"}
have = {p["id"] for p in politicians}
departing = 0
for m in legis:
    t = m["terms"][-1]
    bio = m["id"]["bioguide"]
    chamber = "senate" if t["type"] == "sen" else "house"
    voting = 0 if (chamber == "house" and t["state"] in NONVOTE) else 1
    role = "Senator" if chamber == "senate" else ("Delegate" if not voting else "Representative")
    party = PARTY.get(t["party"], t["party"][:1])
    terms.append({"politician_id": bio, "congress": 119, "chamber": chamber, "state": t["state"],
                  "district": t.get("district") or None, "party": party, "voting": voting, "role": role})
    if bio in have:
        continue
    departing += 1
    ids = m["id"]
    s_ = social.get(bio, {})
    yt = s_.get("youtube")
    politicians.append({**lean_for(bio),
        "id": bio, "name": m["name"].get("official_full") or f"{m['name']['first']} {m['name']['last']}",
        "first": m["name"]["first"], "last": m["name"]["last"], "chamber": chamber, "role": role,
        "state": t["state"], "district": t.get("district") or None, "party": party, "caucus": t.get("caucus", ""),
        "voting": voting, "status": "departing", "term_start": t["start"], "term_end": "2027-01-03",
        "next_election": "", "website": t.get("url", ""), "contact_form": t.get("contact_form", ""),
        "phone": t.get("phone", "") or SWITCHBOARD, "office": t.get("office", t.get("address", "")),
        **contact(bio, m["name"].get("official_full") or m["name"]["last"], bool(t.get("phone"))),
        "twitter": s_.get("twitter", ""), "twitter_alt": ", ".join(sorted(h for h in wd_tw.get(bio, ()) if h.lower() != s_.get("twitter", "").lower())),
        "facebook": s_.get("facebook", ""), "instagram": s_.get("instagram", ""),
        "youtube": f"https://www.youtube.com/{yt}" if yt else "", "bluesky": wd_bsky.get(bio, ""),
        "mastodon": s_.get("mastodon", ""), "opensecrets_id": ids.get("opensecrets", ""),
        "fec_ids": ", ".join(ids.get("fec", [])), "govtrack_id": ids.get("govtrack"),
        "wikipedia": ids.get("wikipedia", ""), "ballotpedia": ids.get("ballotpedia", ""),
        "photo_url": f"https://unitedstates.github.io/images/congress/225x275/{bio}.jpg",
        "notes": "Serving in the 119th Congress; not returning in January 2027."})
    if bio in support:
        note, url = support[bio]
        positions.append({"politician_id": bio, "policy_id": "m4a", "stance": "supports", "note": note,
                          "source_url": url, "updated_at": TODAY})
    finance.append({"politician_id": bio, "as_of": TODAY, "data": finance_for(ids.get("fec", []), "")})

# ---------------------------------------------------------------- 2026 election results + exit polls
import results2026
exit_polls = {"national": [], "senate": {}}
for fn in ("exit_a.json", "exit_b.json"):
    f = RAW / "research" / fn
    if f.exists():
        try:
            d = json.load(open(f, encoding="utf-8"))
            exit_polls["national"] += d.get("national", [])
            exit_polls["senate"].update(d.get("senate", {}))
        except ValueError as e:
            print("skipping unreadable", fn, e)
HEDGE = re.compile(r"appear to|appears to|page's|columns?\b|unlabel|assum|unclear which|likely refer", re.I)
good = lambda fs: [x for x in fs if isinstance(x, dict) and x.get("stat") and re.match(r"https?://", x.get("url") or "")
                   and not HEDGE.search(x["stat"])]  # drop findings the researcher couldn't pin down
exit_polls["national"] = good(exit_polls["national"])
races = []
for r in results2026.senate(RAW / "wp_senate2026.json"):
    races.append({"chamber": "senate", "state": r["state"], "district": None, "special": int(r["special"]),
                  "pvi": "", "result": r["result"], "candidates": r["candidates"],
                  "winner_id": seat_pid.get(("senate", r["state"], "special" if r["special"] else 2)),
                  "exit_polls": good(exit_polls["senate"].get(r["state"], [])) if not (r["state"] in ("FL", "OH") and not r["special"]) else []})
for r in results2026.house(RAW / "wp_house2026.json"):
    races.append({"chamber": "house", "state": r["state"], "district": r["district"] or None, "special": 0,
                  "pvi": r["pvi"], "result": r["result"], "candidates": r["candidates"],
                  "winner_id": seat_pid.get(("house", r["state"], r["district"] or 0)), "exit_polls": []})

# ---------------------------------------------------------------- issues + polling
issues, issue_polls = [], []
f = RAW / "research" / "issues.json"
if f.exists():
    for i, it in enumerate(json.load(open(f, encoding="utf-8"))):
        iid = re.sub(r"[^a-z0-9_]+", "_", (it.get("id") or it["name"]).lower()).strip("_")
        issues.append({"id": iid, "name": it["name"], "description": it.get("description", ""),
                       "rank": it.get("rank") or i + 1})
        for pl in it.get("polls", []):
            if pl.get("stat") and re.match(r"https?://", pl.get("url") or ""):
                issue_polls.append({"issue_id": iid, "pollster": pl.get("pollster", ""), "date": pl.get("date", ""),
                                    "stat": pl["stat"], "url": pl["url"]})

EXEC = [("EXEC-POTUS", "Donald J. Trump", "Donald", "Trump", "President", "https://www.whitehouse.gov/",
         "POTUS", "realDonaldTrump", "Can sign or veto the bill."),
        ("EXEC-VPOTUS", "JD Vance", "JD", "Vance", "Vice President", "https://www.whitehouse.gov/",
         "VP", "JDVance", "Casts the tie-breaking vote in the Senate.")]
for pid, name, first, last, role, site, tw, alt, note in EXEC:
    for cg in (119, 120):
        terms.append({"politician_id": pid, "congress": cg, "chamber": "executive", "state": "US", "district": None,
                      "party": "R", "voting": 0, "role": role})
    politicians.append({"lean": "unknown", "ideology": None, "lean_note": "",
        "id": pid, "name": name, "first": first, "last": last, "chamber": "executive", "role": role,
        "state": "US", "district": None, "party": "R", "caucus": "", "voting": 0, "status": "current",
        "term_start": "2025-01-20", "term_end": "2029-01-20", "next_election": "2028-11-07", "website": site, "contact_form": "",
        "phone": "202-456-1111", "phone_label": "White House comment line", "offices": "[]", "committees": "[]",
        "office": "", "twitter": tw, "twitter_alt": alt, "facebook": "", "instagram": "",
        "youtube": "", "bluesky": "", "mastodon": "", "opensecrets_id": "", "fec_ids": "",
        "govtrack_id": None, "wikipedia": name, "ballotpedia": "", "photo_url": "", "notes": note})

policies = [
    {"id": "m4a", "name": "Medicare for All", "is_primary": 1, "sort": 0,
     "description": "Single-payer national health insurance. Counting the Congress sworn in on January 3, 2027: "
                    "returning members by whether they cosponsored the Medicare for All Act (H.R.3069 / S.1506), "
                    "newcomers by what they said on the trail. A public option does not count as support.",
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

meta = {"congresses": [{"id": 120, "label": "120th Congress (from Jan 3, 2027)"},
                       {"id": 119, "label": "119th Congress (until Jan 3, 2027)"}], "default_congress": 120,
        "exit_national": exit_polls["national"],
        "results_source": "https://en.wikipedia.org/wiki/2026_United_States_House_of_Representatives_elections",
        "congress": "120th", "sworn_in": "2027-01-03", "undecided": undecided,
        "roster_source": f"https://en.wikipedia.org/w/index.php?title=120th_United_States_Congress&oldid={ROSTER_REV}"}
seed = {"version": f"120b-{TODAY}-{len(positions)}-{len(issues)}-{len(exit_polls['national'])}-{len(exit_polls['senate'])}",
        "terms": terms, "races": races, "issues": issues, "issue_polls": issue_polls, "meta": meta, "generated": TODAY, "politicians": politicians, "positions": positions, "policies": policies,
        "outlets": outlets, "finance": finance}
# The Worker reloads the baseline whenever this version changes, so make it a fingerprint of the content.
import hashlib
seed["version"] = "v-" + hashlib.sha256(json.dumps({k: v for k, v in seed.items() if k not in ("version", "generated")},
                                                   sort_keys=True).encode()).hexdigest()[:16]
(OUT / "seed.json").write_text(json.dumps(seed, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

# ---------------------------------------------------------------- report
c = collections.Counter((p["chamber"], p["voting"]) for p in politicians)
sup = collections.Counter(next(p["chamber"] for p in politicians if p["id"] == x["politician_id"]) for x in positions)
print("politicians", len(politicians), dict(c), dict(kinds), "undecided", undecided)
print("stances", collections.Counter(x["stance"] for x in positions), "research rows", len(research))
print("new/comeback without FEC match:", [p["name"] for p in politicians if p["status"] == "incoming" and not p["fec_ids"]])
print("no photo:", sum(1 for p in politicians if not p["photo_url"]), "no website:", sum(1 for p in politicians if not p["website"]), "no X:", sum(1 for p in politicians if not p["twitter"]))
print("M4A supporters", dict(sup), "cosponsors not returning:", len(set(support) - {p['id'] for p in politicians}))
print("with twitter", sum(1 for p in politicians if p["twitter"]), "alt", sum(1 for p in politicians if p["twitter_alt"]),
      "bluesky", sum(1 for p in politicians if p["bluesky"]), "website", sum(1 for p in politicians if p["website"]))
fd = [f["data"] for f in finance]
print("finance has_data", sum(1 for f in fd if f["has_data"]), "with PAC gifts", sum(1 for f in fd if f["pac_count"]),
      "with health PACs", sum(1 for f in fd if f["health_total"] > 0), "with outside", sum(1 for f in fd if f["outside"]["count"]))
print("terms", collections.Counter(t["congress"] for t in terms), "departing", departing,
      "races", collections.Counter(r["chamber"] for r in races), "races w/o winner id", [(r["state"], r["district"]) for r in races if not r["winner_id"]],
      "issues", len(issues), "polls", len(issue_polls), "exit national", len(exit_polls["national"]), "exit states", len(exit_polls["senate"]))
print("lean", collections.Counter(p["lean"] for p in politicians))
t120s = {t["politician_id"] for t in terms if t["congress"] == 120}
m120 = [p for p in politicians if p["id"] in t120s and p["chamber"] != "executive"]
posd = {x["politician_id"]: x for x in positions}
print("120: direct phone", sum(1 for p in m120 if not p["phone_label"]), "switchboard", sum(1 for p in m120 if p["phone_label"]),
      "with district offices", sum(1 for p in m120 if p["offices"] != "[]"), "with committees", sum(1 for p in m120 if p["committees"] != "[]"))
print("120 stances", collections.Counter(posd[p["id"]]["stance"] if p["id"] in posd else "unknown" for p in m120))
print("leadership PACs matched", sum(1 for f in finance if f["data"].get("leadership")),
      "health $ via leadership", round(sum(l["health_total"] for f in finance for l in f["data"].get("leadership", []))))
print("seed bytes", (OUT / "seed.json").stat().st_size)
