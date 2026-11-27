#!/usr/bin/env python3
"""State campaign money for governors and state legislators, from states that publish every
contribution through an open data API (Socrata SoQL), aggregated on the state's own server:

  WA  Public Disclosure Commission      data.wa.gov  kv7h-kjye  (contributions to candidates)
  NY  State Board of Elections          data.ny.gov  4j2b-6a2j  (contributions), e9ss-239a (donor employers),
                                                     udeh-rt5n  (active committees)
  HI  Campaign Spending Commission      hicscdata.hawaii.gov  jexd-xbcg

For each candidate's latest campaign: total itemized contributions, by kind of donor, the biggest
organizational donors by name, and health-industry money (health companies, their PACs and trade groups,
plus individuals whose listed employer is a health company). Individual donors are only kept as totals
by employer: no individual's name is stored (WA and NY bar using contributor lists to solicit).

Matches candidates to Open States people in data/raw/state_officials.json (run state_officials.py first)
and writes data/raw/state_finance.json: {"generated", "states": {...}, "finance": {politician_id: data}}.
Run:  python3 scripts/state_finance.py   (needs network; aggregates are cached in data/raw/state_finance/)
"""
import collections, datetime, json, pathlib, re, subprocess, sys, unicodedata, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "state_finance"
CACHE.mkdir(parents=True, exist_ok=True)
TODAY = datetime.date.today().isoformat()
REFRESH = "--refresh" in sys.argv

# ---------------------------------------------------------------- health-industry matching
ORG_SECTORS = [
    ("insurance", re.compile(
        r"UNITEDHEALTH|UNITED HEALTH ?GROUP|UNITED ?HEALTHCARE|OPTUM|ELEVANCE|\bANTHEM\b|\bCIGNA\b|EVERNORTH|HUMANA|"
        r"\bAETNA\b|CVS HEALTH|CVS CAREMARK|CENTENE|MOLINA|BLUE ?CROSS|BLUE ?SHIELD|\bBCBS|HEALTH CARE SERVICE CORP|"
        r"HIGHMARK|WELLCARE|OSCAR HEALTH|EXPRESS SCRIPTS|GUIDEWELL|CAREFIRST|CAMBIA|REGENCE|PREMERA|KAISER (?:PERMANENTE|FOUNDATION|HEALTH)|"
        r"HEALTH INSURANCE PLANS|\bAHIP\b|HEALTH ?PLANS?\b|HEALTHFIRST|EMBLEMHEALTH|FIDELIS|EXCELLUS|MVP HEALTH|\bHMSA\b|"
        r"HAWAII MEDICAL SERVICE ASS|PHARMACEUTICAL CARE MANAGEMENT|HEALTH UNDERWRITERS|PRIME THERAPEUTICS")),
    ("pharma", re.compile(
        r"PFIZER|\bMERCK\b|ABBVIE|\bAMGEN\b|ELI LILLY|LILLY (?:AND|&) CO|JOHNSON (?:&|AND) JOHNSON|JANSSEN|BRISTOL[- ]?MYERS|"
        r"NOVARTIS|SANOFI|GLAXOSMITHKLINE|\bGSK\b|ASTRAZENECA|GILEAD|NOVO NORDISK|\bBAYER\b|TAKEDA|REGENERON|BIOGEN|"
        r"\bTEVA\b|PHARMACEUTIC|\bPHARMA\b|BIOPHARM|PHRMA\b|GENENTECH|BOEHRINGER|ASTELLAS|OTSUKA|VIATRIS|MODERNA|"
        r"ABBOTT LAB|MCKESSON|CARDINAL HEALTH|CENCORA|AMERISOURCE|BIOTECHNOLOGY INNOVATION|BIOTECH")),
    ("devices", re.compile(
        r"MEDTRONIC|ADVAMED|BOSTON SCIENTIFIC|STRYKER|BECTON|BAXTER|ZIMMER|INTUITIVE SURGICAL|EDWARDS LIFESCIENCES|"
        r"HOLOGIC|GE HEALTHCARE|SIEMENS HEALTHINEERS|DEXCOM|RESMED|MEDICAL DEVICE")),
    ("providers", re.compile(
        r"DAVITA|FRESENIUS|DIALYSIS|LABCORP|LABORATORY CORP|QUEST DIAGNOSTICS|HEALTH CARE ASSOCIATION|HEALTHCARE ASSOCIATION|"
        r"NURSING HOME|LONG.TERM CARE|HOME CARE|HOME HEALTH|HOSPICE|ENVISION|TEAMHEALTH|SURGERY CENTER|ASSISTED LIVING|"
        r"\bHCA\b|TENET HEALTH|COMMUNITY HEALTH SYSTEMS|UNIVERSAL HEALTH SERVICES|AMBULANCE")),
    ("doctors", re.compile(
        r"MEDICAL ASSOCIATION|MEDICAL SOCIETY|PHYSICIANS|ANESTHESIOLOG|RADIOLOG|COLLEGE OF SURGEONS|ORTHOPA?EDIC|"
        r"DERMATOLOG|CARDIOLOG|UROLOG|OPHTHALMOLOG|ONCOLOG|DENTAL ASSOCIATION|DENTAL PAC|OPTOMETRIC|CHIROPRACT|"
        r"PODIATR|OSTEOPATHIC|MEDPAC|DOCTORS")),
    ("hospitals", re.compile(r"HOSPITALS?\b|HEALTH SYSTEM|HEALTHCARE SYSTEM")),
]
# Employers of individual donors: big for-profit companies only (as for federal data). Nonprofit
# hospitals' staff, nurses and unions are left out: their giving says little about industry interests.
EMPLOYER_SECTORS = [(n, rx) for n, rx in ORG_SECTORS if n in ("insurance", "pharma", "devices")] + [
    ("providers", re.compile(r"DAVITA|FRESENIUS|LABCORP|LABORATORY CORP|QUEST DIAGNOSTICS|ENVISION HEALTH|TEAMHEALTH|"
                             r"\bHCA\b|HCA HEALTHCARE|TENET HEALTH|COMMUNITY HEALTH SYSTEMS|UNIVERSAL HEALTH SERVICES"))]
NOT_HEALTH = re.compile(r"VETERINAR|ANIMAL|\bPET\b|NURS|UNION|WORKERS|SEIU|AFL.CIO|TEAMSTERS|1199|LABOR|\bAFSCME\b|"
                        r"HEALTH ?CARE FOR ALL|SINGLE.PAYER|MEDICARE FOR ALL|PUBLIC HEALTH")
PARTY_RX = re.compile(r"\b(REPUBLICANS?|DEMOCRATS?|DEMOCRATIC|GOP|DFL)\b|\bCAUCUS\b|\bPARTY\b|ORGANIZATIONAL COMMITTEE|CAMPAIGN COMMITTEE")
SUFFIX = re.compile(r"[.,]|\b(INC|INCORPORATED|LLC|L L C|CORP|CORPORATION|CO|COMPANY|LTD|LP|PLC|USA|US|THE)\b")
EMP_SKIP = re.compile(r"^(N/?A|NONE|SELF|SELF[- ]EMPLOYED|RETIRED|NOT EMPLOYED|UNEMPLOYED|HOMEMAKER|INFORMATION REQUESTED.*|)$")


def health(name, rules=ORG_SECTORS):
    t = (name or "").upper()
    if not t or NOT_HEALTH.search(t):
        return None
    return next((n for n, rx in rules if rx.search(t)), None)


# ---------------------------------------------------------------- SoQL helper (curl: this Python has no CA bundle)
def soql(base, cache_name, **kw):
    f = CACHE / f"{cache_name}.json"
    if f.exists() and not REFRESH:
        return json.loads(f.read_text())
    rows, off = [], 0
    while True:
        params = {"$" + k: v for k, v in kw.items()} | {"$limit": 50000, "$offset": off}
        out = subprocess.run(["curl", "-sS", "-m", "600", "--retry", "3", base + "?" + urllib.parse.urlencode(params)],
                             capture_output=True, check=True).stdout
        page = json.loads(out)
        if isinstance(page, dict):
            raise SystemExit(f"{cache_name}: {page}")
        rows += page
        if len(page) < 50000:
            break
        off += 50000
    f.write_text(json.dumps(rows))
    print(f"  {cache_name}: {len(rows)} rows")
    return rows


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def slug(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def new_cand(**kw):
    return {"total": 0.0, "n": 0, "kinds": collections.Counter(), "orgs": collections.Counter(), "org_kind": {},
            "emp": collections.Counter(), **kw}


# ---------------------------------------------------------------- Washington
def washington():
    base = "https://data.wa.gov/resource/kv7h-kjye.json"
    where = ("election_year in('2023','2024','2025','2026') AND office in('STATE SENATOR','STATE REPRESENTATIVE','GOVERNOR') "
             "AND type='Candidate'")
    kind = {"Individual": "individual", "Self": "self", "Party": "party", "Caucus": "party", "Political Action Committee": "pac",
            "Business": "business", "Union": "union"}
    tot = soql(base, "WA_totals", select="filer_id,filer_name,office,legislative_district,election_year,code,contributor_category,sum(amount) as amt,count(*) as n",
               where=where, group="filer_id,filer_name,office,legislative_district,election_year,code,contributor_category", order="filer_id,election_year,code")
    latest = {}
    for r in tot:
        latest[r["filer_id"]] = max(latest.get(r["filer_id"], "0"), r["election_year"])
    cands = {}
    for r in tot:
        if r["election_year"] != latest[r["filer_id"]]:
            continue
        c = cands.setdefault(r["filer_id"], new_cand(name=r["filer_name"], office=r["office"], district=r.get("legislative_district", ""),
                                                     cycle=r["election_year"]))
        k = kind.get(r["code"], "other")
        if r.get("contributor_category") == "Individual" and k != "self":
            k = "individual"  # people filed under "Other"
        c["total"] += num(r["amt"]); c["n"] += int(r["n"]); c["kinds"][k] += num(r["amt"])
    orgs = soql(base, "WA_orgs", select="filer_id,election_year,code,contributor_name,sum(amount) as amt",
                where=where + " AND contributor_category='Organization'", group="filer_id,election_year,code,contributor_name",
                order="filer_id,election_year,code,contributor_name")
    for r in orgs:
        c = cands.get(r["filer_id"])
        if c and r["election_year"] == c["cycle"]:
            c["orgs"][r.get("contributor_name", "")] += num(r["amt"]); c["org_kind"][r.get("contributor_name", "")] = kind.get(r["code"], "other")
    emp = soql(base, "WA_employers", select="filer_id,election_year,upper(contributor_employer_name) as emp,sum(amount) as amt",
               where=where + " AND code='Individual' AND contributor_employer_name IS NOT NULL AND NOT upper(contributor_occupation) like '%NURS%'",
               group="filer_id,election_year,emp", order="filer_id,election_year,emp")
    for r in emp:
        c = cands.get(r["filer_id"])
        if c and r["election_year"] == c["cycle"]:
            c["emp"][r.get("emp", "")] += num(r["amt"])
    out = []
    for fid, c in cands.items():
        chamber = {"STATE SENATOR": "state_upper", "STATE REPRESENTATIVE": "state_lower", "GOVERNOR": "governor"}[c["office"]]
        nm = c["name"]
        out.append({**c, "chamber": chamber, "last": nm.split()[-1] if nm.split() else "", "first": nm.split()[0] if nm else "",
                    "full": nm, "key": fid,
                    "source_url": "https://data.wa.gov/d/kv7h-kjye"})
    return out


# ---------------------------------------------------------------- Hawaii
def hawaii():
    base = "https://hicscdata.hawaii.gov/resource/jexd-xbcg.json"
    where = "office in('Governor','Senate','House') AND election_period >= '2020'"
    kind = {"Individual": "individual", "Candidate": "self", "Immediate Family": "self", "Political Party": "party",
            "Noncandidate Committee": "pac", "Other Entity": "business"}
    tot = soql(base, "HI_totals", select="reg_no,candidate_name,office,district,election_period,contributor_type,sum(amount) as amt,count(*) as n",
               where=where, group="reg_no,candidate_name,office,district,election_period,contributor_type", order="reg_no,election_period")
    latest = {}
    for r in tot:
        p = r["election_period"]
        if p.split("-")[-1] >= "2024" and p > latest.get(r["reg_no"], ""):
            latest[r["reg_no"]] = p
    cands = {}
    for r in tot:
        if latest.get(r["reg_no"]) != r["election_period"]:
            continue
        c = cands.setdefault(r["reg_no"], new_cand(name=r["candidate_name"], office=r["office"], district=r.get("district", ""),
                                                   cycle=r["election_period"]))
        c["total"] += num(r["amt"]); c["n"] += int(r["n"]); c["kinds"][kind.get(r["contributor_type"], "other")] += num(r["amt"])
    orgs = soql(base, "HI_orgs", select="reg_no,election_period,contributor_type,contributor_name,sum(amount) as amt",
                where=where + " AND contributor_type in('Noncandidate Committee','Other Entity','Political Party')",
                group="reg_no,election_period,contributor_type,contributor_name", order="reg_no,election_period,contributor_name")
    for r in orgs:
        c = cands.get(r["reg_no"])
        if c and r["election_period"] == c["cycle"]:
            c["orgs"][r.get("contributor_name", "")] += num(r["amt"]); c["org_kind"][r.get("contributor_name", "")] = kind.get(r["contributor_type"], "other")
    emp = soql(base, "HI_employers", select="reg_no,election_period,upper(employer) as emp,sum(amount) as amt",
               where=where + " AND contributor_type='Individual' AND employer IS NOT NULL AND NOT upper(occupation) like '%NURS%'",
               group="reg_no,election_period,emp", order="reg_no,election_period,emp")
    for r in emp:
        c = cands.get(r["reg_no"])
        if c and r["election_period"] == c["cycle"]:
            c["emp"][r.get("emp", "")] += num(r["amt"])
    out = []
    for rid, c in cands.items():
        last, _, first = c["name"].partition(",")
        chamber = {"Senate": "state_upper", "House": "state_lower", "Governor": "governor"}[c["office"]]
        out.append({**c, "chamber": chamber, "last": last.strip(), "first": first.strip().split()[0] if first.strip() else "",
                    "full": f"{first.strip()} {last.strip()}", "key": rid,
                    "source_url": "https://hicscdata.hawaii.gov/d/jexd-xbcg"})
    return out


# ---------------------------------------------------------------- New York
def new_york(people):
    cmtes = soql("https://data.ny.gov/resource/udeh-rt5n.json", "NY_committees", select="filer_id,filer_name,committee_type_desc",
                 where="filer_type_desc='State' AND committee_type_desc in('Authorized Single Candidate Committee','Public Campaign Finance Committee')",
                 order="filer_id")
    cmtes = [c for c in cmtes if not re.search(r"(?i)court|judge|judicial|council|mayor|borough|district attorney|sheriff", c["filer_name"])]
    # Every active candidate for a statewide or legislative office: a surname-only committee name is
    # trusted only when no other such candidate shares the surname.
    cands = soql("https://data.ny.gov/resource/epr8-9fny.json", "NY_candidates", select="filer_id,filer_name,office_desc",
                 where="filer_type_desc='State'", order="filer_id")
    cand_lasts = collections.Counter(slug(c["filer_name"]).split()[-1] for c in cands if slug(c["filer_name"]).split())
    ny = [p for p in people if p["state"] == "NY"]
    # A committee belongs to a member when its name holds their last name and their first name (or a
    # 1-letter initial) and no other New York officeholder fits it too.
    # Committees named only for the surname ("Stirpe for Assembly") count when that surname is unique among
    # New York officeholders and nothing before it in the name could be someone else's first name.
    owner = {}
    lasts = collections.Counter(slug(p["last"]) for p in ny)
    filler = {"friends", "of", "for", "committee", "to", "elect", "re", "the", "people", "citizens", "team", "a", "an", "and", "neighbors"}
    for c in cmtes:
        words = re.sub(r"(\d)", r" \1 ", slug(c["filer_name"])).split()
        text = " ".join(words)
        fits = []
        for p in ny:
            last = " ".join(slug(p["last"]).split())
            if not last or f" {last} " not in f" {text} ":
                continue
            firsts = {slug(p["first"]), slug(p["name"].split()[0])} - {""}
            before = text.split(f"{last}")[0].split() if text.find(last) >= 0 else []
            if any(f in words for f in firsts):
                fits.append(p)
            elif lasts[slug(p["last"])] == 1 and cand_lasts[last.split()[-1]] <= 1 and all(w in filler or len(w) == 1 for w in before) and \
                    (text.split(last, 1)[1].split() or [""])[0] in ("", "for", "4", "2", "to", "in", "ny", "nys", "assembly", "senate"):
                fits.append(p)
        if len(fits) == 1:
            owner[c["filer_id"]] = fits[0]
    ids = sorted(owner)
    base = "https://data.ny.gov/resource/4j2b-6a2j.json"
    kind = {"Individual": "individual", "Candidate/Candidate Spouse": "self", "Candidate Family Member": "self",
            "Political Action Committee (PAC)": "pac", "Political Committee": "pac", "Union": "union", "Corporation": "business",
            "Professional/Limited Liability Company (PLLC/LLC)": "business", "Partnership including LLPs": "business",
            "Sole Proprietorship": "business", "Association": "business"}
    tot, orgs, emp = [], [], []
    for i in range(0, len(ids), 150):  # keep URLs short
        chunk = ",".join(f"'{x}'" for x in ids[i:i + 150])
        where = f"filer_id in({chunk}) AND election_year in('2025','2026') AND filing_sched_abbrev in('A','B','C','D')"
        tot += soql(base, f"NY_totals_{i}", select="filer_id,cntrbr_type_desc,sum(org_amt) as amt,count(*) as n",
                    where=where, group="filer_id,cntrbr_type_desc", order="filer_id")
        orgs += soql(base, f"NY_orgs_{i}", select="filer_id,cntrbr_type_desc,flng_ent_name,sum(org_amt) as amt",
                     where=where + " AND filing_sched_abbrev in('B','C') AND flng_ent_name IS NOT NULL",
                     group="filer_id,cntrbr_type_desc,flng_ent_name", order="filer_id,flng_ent_name")
        emp += soql("https://data.ny.gov/resource/e9ss-239a.json", f"NY_employers_{i}",
                    select="filer_id,upper(employer) as emp,sum(org_amt) as amt",
                    where=where.replace("in('A','B','C','D')", "='A'") + " AND employer IS NOT NULL AND NOT upper(emp_occupation) like '%NURS%'",
                    group="filer_id,emp", order="filer_id,emp")
    by_person = {}
    for r in tot:
        p = owner[r["filer_id"]]
        c = by_person.setdefault(p["id"], new_cand(name=p["name"], cycle="2025–26", key=p["id"], committees=[]))
        k = kind.get(r.get("cntrbr_type_desc"), "individual" if not r.get("cntrbr_type_desc") else "other")
        c["total"] += num(r["amt"]); c["n"] += int(r["n"]); c["kinds"][k] += num(r["amt"])
        if r["filer_id"] not in c["committees"]:
            c["committees"].append(r["filer_id"])
    for r in orgs:
        c = by_person.get(owner[r["filer_id"]]["id"])
        if c:
            c["orgs"][r["flng_ent_name"]] += num(r["amt"]); c["org_kind"][r["flng_ent_name"]] = kind.get(r.get("cntrbr_type_desc"), "other")
    for r in emp:
        c = by_person.get(owner[r["filer_id"]]["id"])
        if c:
            c["emp"][r.get("emp", "")] += num(r["amt"])
    for pid, c in by_person.items():
        c["pid"] = pid
        c["source_url"] = "https://publicreporting.elections.ny.gov/"
    names = {x["filer_id"]: x["filer_name"] for x in cmtes}
    for c in by_person.values():
        c["committee_names"] = [names[x] for x in c["committees"]]
    return list(by_person.values())


# ---------------------------------------------------------------- bulk downloads (Texas, California)
BULK = RAW / "bulk"
BULK_URLS = {"TEC_CF_CSV.zip": "https://prd.tecprd.ethicsefile.com/public/cf/public/TEC_CF_CSV.zip",
             "dbwebexport.zip": "https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip"}


def bulk(name):
    f = BULK / name
    if REFRESH or not f.exists():
        BULK.mkdir(parents=True, exist_ok=True)
        print("  downloading", name)
        subprocess.run(["curl", "-sSL", "-m", "3600", "--retry", "3", "-o", str(f), BULK_URLS[name]], check=True)
    return f


def org_kind(name, default="business"):
    u = (name or "").upper()
    if PARTY_RX.search(u):
        return "party"
    if re.search(r"\bPAC\b|POLITICAL ACTION|COMMITTEE|\bFUND\b|ASSOCIATION|COALITION|COUNCIL", u):
        return "pac"
    return default


def cached(name, build):
    f = CACHE / f"{name}.json"
    if f.exists() and not REFRESH:
        return json.loads(f.read_text())
    out = build()
    f.write_text(json.dumps(out))
    return out


def as_cands(raw):
    """Cached plain-dict candidates back into counters."""
    out = []
    for c in raw:
        c = dict(c)
        for k in ("kinds", "orgs", "emp"):
            c[k] = collections.Counter(c[k])
        out.append(c)
    return out


# ---------------------------------------------------------------- Texas
def texas():
    def build():
        import csv, io, zipfile
        csv.field_size_limit(10 ** 8)
        z = zipfile.ZipFile(bulk("TEC_CF_CSV.zip"))
        office = {"STATESEN": "state_upper", "STATEREP": "state_lower", "GOVERNOR": "governor"}
        filers = {}
        for r in csv.DictReader(io.TextIOWrapper(z.open("filers.csv"), encoding="latin-1", newline="")):
            if r["filerTypeCd"] != "COH":
                continue
            # The office sought comes first: a state representative running for governor raises for that race.
            for oc, od in ((r["ctaSeekOfficeCd"], r["ctaSeekOfficeDistrict"]), (r["contestSeekOfficeCd"], r["contestSeekOfficeDistrict"]),
                           (r["filerHoldOfficeCd"], r["filerHoldOfficeDistrict"])):
                if oc in office:
                    filers[r["filerIdent"]] = {"chamber": office[oc], "district": od, "last": r["filerNameLast"],
                                               "first": (r["filerNameFirst"] or "").split()[0] if r["filerNameFirst"] else "",
                                               "full": f"{r['filerNameFirst']} {r['filerNameLast']}"}
                    break
        # Specific-purpose committees named for a candidate ("Texans for Greg Abbott") raise for that candidate.
        by_name = collections.defaultdict(list)
        for fid, f in filers.items():
            by_name[slug(f["full"])].append(fid)
        owner, own_names = {}, collections.defaultdict(set)
        for r in csv.DictReader(io.TextIOWrapper(z.open("filers.csv"), encoding="latin-1", newline="")):
            if r["filerTypeCd"] != "SPAC":
                continue
            nm = f" {slug(r['filerName'])} "
            fits = {fid for full, ids in by_name.items() if full and f" {full} " in nm for fid in ids}
            if len(fits) == 1:
                owner[r["filerIdent"]] = fits.pop()
        names = {}
        for r in csv.DictReader(io.TextIOWrapper(z.open("filers.csv"), encoding="latin-1", newline="")):
            names[r["filerIdent"]] = slug(r["filerName"])
        for spac, fid in owner.items():
            own_names[fid].add(names.get(spac, ""))
        print("   TX candidate committees", len(owner))
        cands = {}
        for name in sorted(n for n in z.namelist() if re.match(r"contribs_\d+\.csv$", n)):
            for r in csv.DictReader(io.TextIOWrapper(z.open(name), encoding="latin-1", newline="")):
                fid = owner.get(r["filerIdent"], r["filerIdent"])
                if fid not in filers or r["infoOnlyFlag"] == "Y" or r["contributionDt"] < "20250101":
                    continue
                if r["contributorPersentTypeCd"] == "ENTITY" and slug(r["contributorNameOrganization"]) in own_names[fid]:
                    continue  # money moved between the candidate's own committees
                f = filers[fid]
                c = cands.setdefault(fid, {"total": 0.0, "n": 0, "kinds": collections.Counter(), "orgs": collections.Counter(),
                                           "org_kind": {}, "emp": collections.Counter(), "cycle": "2025–26", "key": fid, **f})
                amt = num(r["contributionAmount"])
                c["total"] += amt; c["n"] += 1
                if r["contributorPersentTypeCd"] == "ENTITY":
                    nm = r["contributorNameOrganization"].strip()
                    k = org_kind(nm)
                    c["kinds"][k] += amt; c["orgs"][nm] += amt; c["org_kind"][nm] = k
                else:
                    self_ = slug(r["contributorNameLast"]) == slug(f["last"]) and slug(r["contributorNameFirst"]).startswith(slug(f["first"]) or "~")
                    c["kinds"]["self" if self_ else "individual"] += amt
                    emp = (r["contributorEmployer"] or "").strip().upper()
                    if emp and "NURS" not in (r["contributorOccupation"] or "").upper():
                        c["emp"][emp] += amt
            print("   ", name, len(cands))
        return list(cands.values())
    out = as_cands(cached("TX_agg", build))
    for c in out:
        c["source_url"] = "https://www.ethics.texas.gov/search/cf/"
    return out


# ---------------------------------------------------------------- California
def california():
    def build():
        import io, zipfile
        z = zipfile.ZipFile(bulk("dbwebexport.zip"))

        def rows(table):
            f = io.TextIOWrapper(z.open(f"CalAccess/DATA/{table}.TSV"), encoding="latin-1")
            h = f.readline().rstrip("\r\n").split("\t")
            for line in f:
                v = line.rstrip("\r\n").split("\t")
                if len(v) == len(h):
                    yield dict(zip(h, v))

        def year(d):
            d = d.split(" ")[0]
            return d[-4:] if len(d) >= 4 else ""
        office = {"ASM": "state_lower", "SEN": "state_upper", "GOV": "governor"}
        latest, filing_cand = {}, {}
        for r in rows("CVR_CAMPAIGN_DISCLOSURE_CD"):
            if r["FORM_TYPE"] != "F460" or r["ENTITY_CD"] not in ("CTL", "CAO") or r["OFFICE_CD"] not in office:
                continue
            if year(r["THRU_DATE"]) not in ("2025", "2026"):
                continue
            fid, aid = r["FILING_ID"], int(r["AMEND_ID"] or 0)
            if aid >= latest.get(fid, -1):
                latest[fid] = aid
                key = (r["OFFICE_CD"], r["DIST_NO"].lstrip("0"), slug(r["CAND_NAML"]), slug(r["CAND_NAMF"]).split(" ")[0] if r["CAND_NAMF"] else "")
                filing_cand[fid] = (key, r["FILER_NAML"], r["CAND_NAML"], r["CAND_NAMF"])
        print("   CA filings", len(latest))
        cands = {}
        for r in rows("RCPT_CD"):
            fid = r["FILING_ID"]
            if fid not in latest or int(r["AMEND_ID"] or 0) != latest[fid] or r["FORM_TYPE"] not in ("A", "C"):
                continue
            if r["MEMO_CODE"] == "X" or year(r["RCPT_DATE"]) not in ("2025", "2026"):
                continue
            key, cmte, last, first = filing_cand[fid]
            k = "|".join(key)
            c = cands.setdefault(k, {"total": 0.0, "n": 0, "kinds": collections.Counter(), "orgs": collections.Counter(), "org_kind": {},
                                     "emp": collections.Counter(), "cycle": "2025–26", "key": k, "chamber": office[key[0]],
                                     "district": key[1], "last": last, "first": (first or "").split(" ")[0], "full": f"{first} {last}",
                                     "committee_names": []})
            if cmte not in c["committee_names"]:
                c["committee_names"].append(cmte)
            amt = num(r["AMOUNT"])
            c["total"] += amt; c["n"] += 1
            if r["ENTITY_CD"] == "IND":
                self_ = r["CTRIB_SELF"] == "X" or (slug(r["CTRIB_NAML"]) == slug(last) and slug(r["CTRIB_NAMF"]).startswith(slug(first).split(" ")[0] or "~"))
                c["kinds"]["self" if self_ else "individual"] += amt
                emp = (r["CTRIB_EMP"] or "").strip().upper()
                if emp and "NURS" not in (r["CTRIB_OCC"] or "").upper():
                    c["emp"][emp] += amt
            else:
                nm = " ".join(x for x in (r["CTRIB_NAMF"], r["CTRIB_NAML"]) if x).strip()
                k2 = {"PTY": "party", "COM": org_kind(nm, "pac"), "SCC": "pac"}.get(r["ENTITY_CD"], org_kind(nm))
                c["kinds"][k2] += amt; c["orgs"][nm] += amt; c["org_kind"][nm] = k2
        print("   CA candidates", len(cands))
        return list(cands.values())
    out = as_cands(cached("CA_agg", build))
    for c in out:
        c["source_url"] = "https://cal-access.sos.ca.gov/Campaign/"
    return out


# ---------------------------------------------------------------- Illinois
IL_FILES = ["Receipts.txt", "Committees.txt", "CmteCandidateLinks.txt", "Candidates.txt"]


def illinois():
    def build():
        d = BULK / "il"
        d.mkdir(parents=True, exist_ok=True)
        for name in IL_FILES:
            if REFRESH or not (d / name).exists():
                print("  downloading", name)
                subprocess.run(["curl", "-sSL", "-m", "3600", "--retry", "3", "-o", str(d / name),
                                "https://www.elections.il.gov/CampaignDisclosureDataFiles/" + name], check=True)

        def rows(name):
            with open(d / name, encoding="utf-8-sig", errors="replace", newline="") as f:
                h = f.readline().rstrip("\r\n").split("\t")
                for line in f:
                    v = line.rstrip("\r\n").split("\t")
                    if len(v) >= len(h) - 2:
                        yield dict(zip(h, v))
        office = {"State Senator": "state_upper", "State Representative": "state_lower", "Governor": "governor"}
        cand = {}
        for r in rows("Candidates.txt"):
            if r["Office"] in office:
                first = re.sub(r'"[^"]*"', "", r["FirstName"]).split()
                cand[r["ID"]] = {"chamber": office[r["Office"]], "district": r["District"] if r["Office"] != "Governor" else "",
                                 "last": r["LastName"].replace('"', "").strip(), "first": first[0] if first else "",
                                 "full": f"{r['FirstName']} {r['LastName']}".replace('"', "")}
        ctype = {r["ID"]: (r["TypeOfCommittee"], r["Name"]) for r in rows("Committees.txt")}
        cmte_cand = {}
        for r in rows("CmteCandidateLinks.txt"):
            if r["CandidateID"] in cand and ctype.get(r["CommitteeID"], ("",))[0] == "Candidate":
                # A committee can link to several candidate records over the years: the newest wins.
                if int(r["CandidateID"]) > int(cmte_cand.get(r["CommitteeID"], "0")):
                    cmte_cand[r["CommitteeID"]] = r["CandidateID"]
        # The same person often has several candidate records; one key per person and office.
        key_of = {cid: "|".join((cand[c]["chamber"], cand[c]["district"], slug(cand[c]["last"]), slug(cand[c]["first"])))
                  for cid, c in cmte_cand.items()}
        own = collections.defaultdict(set)
        for cid, k in key_of.items():
            own[k].add(slug(ctype[cid][1]))
        cands = {}
        for r in rows("Receipts.txt"):
            cid = r.get("CommitteeID")
            if cid not in key_of or r.get("Archived") == "True" or (r.get("RcvDate") or "") < "2025-01-01":
                continue
            part = (r.get("D2Part") or "")[:1]
            if part not in ("1", "2", "5"):  # contributions, transfers in, in-kind; not loans or refunds
                continue
            k = key_of[cid]
            org = not (r.get("FirstName") or "").strip()
            nm = " ".join(x for x in (r.get("FirstName", "").strip(), r.get("LastOnlyName", "").strip()) if x)
            if org and slug(nm) in own[k]:
                continue  # between the candidate's own committees
            c = cands.setdefault(k, {"total": 0.0, "n": 0, "kinds": collections.Counter(), "orgs": collections.Counter(), "org_kind": {},
                                     "emp": collections.Counter(), "cycle": "2025–26", "key": k, "committee_names": [],
                                     **cand[cmte_cand[cid]]})
            if ctype[cid][1] not in c["committee_names"]:
                c["committee_names"].append(ctype[cid][1])
            amt = num(r.get("Amount"))
            c["total"] += amt; c["n"] += 1
            if org:
                kk = org_kind(nm, "pac" if part == "2" else "business")
                c["kinds"][kk] += amt; c["orgs"][nm] += amt; c["org_kind"][nm] = kk
            else:
                self_ = slug(r.get("LastOnlyName")) == slug(c["last"]) and slug(r.get("FirstName")).startswith(slug(c["first"]) or "~")
                c["kinds"]["self" if self_ else "individual"] += amt
                emp = (r.get("Employer") or "").strip().upper()
                if emp and "NURS" not in (r.get("Occupation") or "").upper():
                    c["emp"][emp] += amt
        print("   IL candidates", len(cands))
        return list(cands.values())
    out = as_cands(cached("IL_agg", build))
    for c in out:
        c["source_url"] = "https://www.elections.il.gov/CampaignDisclosure/"
    return out


# ---------------------------------------------------------------- matching and output
def summarize(c, st, source):
    hz = collections.Counter(); hz_items = []
    for name, amt in c["orgs"].items():
        s = health(name)
        if s and amt > 0:
            hz[s] += amt; hz_items.append({"name": name, "amount": round(amt), "sector": s, "via": "org"})
    emp = collections.Counter()
    for name, amt in c["emp"].items():
        if not EMP_SKIP.match(name or "") and health(name, EMPLOYER_SECTORS):
            emp[re.sub(r"\s+", " ", SUFFIX.sub(" ", name.upper())).strip() or name] += amt
    for name, amt in emp.items():
        s = health(name, EMPLOYER_SECTORS)
        if s and amt > 0:
            hz[s] += amt; hz_items.append({"name": name.title(), "amount": round(amt), "sector": s, "via": "employees"})
    # Filers often code party and caucus money as "Other" or "Business": go by the donor's name too.
    kinds = collections.Counter({k: v for k, v in c["kinds"].items() if k in ("individual", "self")})
    okind = {}
    for n, a in c["orgs"].items():
        k = c["org_kind"].get(n, "other")
        if k in ("other", "business", "pac") and PARTY_RX.search((n or "").upper()):
            k = "party"
        okind[n] = k
        if a > 0:
            kinds[k] += a
    rest = c["total"] - sum(kinds.values())
    if rest > 1:
        kinds["other"] += rest
    top = [{"name": n, "amount": round(a), "kind": okind.get(n, "other"), "sector": health(n)}
           for n, a in c["orgs"].most_common(15) if a > 0]
    return {"state": True, "st": st, "source": source["name"], "source_url": c.get("source_url") or source["url"],
            "dataset_url": source["url"], "cycle": c["cycle"], "total": round(c["total"]), "n": c["n"],
            "kinds": {k: round(v) for k, v in kinds.most_common() if round(v) > 0},
            "health_total": round(sum(hz.values())), "health_by_sector": {k: round(v) for k, v in hz.most_common()},
            "health_items": sorted(hz_items, key=lambda x: -x["amount"])[:12], "top_orgs": top,
            "committees": c.get("committee_names", [])}


SOURCES = {
    "WA": {"name": "Washington Public Disclosure Commission", "url": "https://data.wa.gov/d/kv7h-kjye"},
    "NY": {"name": "New York State Board of Elections", "url": "https://data.ny.gov/d/4j2b-6a2j"},
    "HI": {"name": "Hawaii Campaign Spending Commission", "url": "https://hicscdata.hawaii.gov/d/jexd-xbcg"},
    "TX": {"name": "Texas Ethics Commission", "url": "https://www.ethics.texas.gov/data-reports/campaign-finance/downloadable-database/"},
    "IL": {"name": "Illinois State Board of Elections", "url": "https://www.elections.il.gov/CampaignDisclosureDataFiles/"},
    "CA": {"name": "California Secretary of State (Cal-Access)", "url": "https://www.sos.ca.gov/campaign-lobbying/cal-access-resources/raw-data-campaign-finance-and-lobbying-activity"},
}

people = json.load(open(RAW / "state_officials.json", encoding="utf-8"))["people"]
by_state = collections.defaultdict(list)
for p in people:
    by_state[p["state"]].append(p)


def dist_norm(d):
    return re.sub(r"^0+", "", re.sub(r"[^0-9A-Z]", "", str(d or "").upper()))


def match(st, cand, anywhere=False):
    hit = match_seat(st, cand)
    if hit or not anywhere:
        return hit
    # Officials whose latest campaign was for another seat (an Assembly member running for the Senate):
    # full first and last name must agree, and only one official may fit.
    first, last = slug(cand["first"]), slug(cand["last"])
    hits = [p for p in by_state[st] if p["chamber"] != "governor" and first and last
            and (slug(p["last"]) == last or slug(p["name"]).split()[-1:] == [last]) and (slug(p["first"]) == first or slug(p["name"]).split()[0] == first)]
    return hits[0] if len(hits) == 1 else None


def match_seat(st, cand):
    pool = [p for p in by_state[st] if p["chamber"] == cand["chamber"]]
    if cand["chamber"] != "governor" and cand.get("district"):
        pool = [p for p in pool if dist_norm(p["sdistrict"]) == dist_norm(cand.get("district"))]
    last = slug(cand["last"])
    hits = [p for p in pool if slug(p["last"]) == last or last in slug(p["name"]).split() or slug(p["last"]) in slug(cand["full"]).split()]
    if len(hits) > 1 or (hits and not cand.get("district") and cand["chamber"] != "governor"):
        # No district to go by (Hawaii leaves it blank on recent filings): the first name must agree too.
        first = slug(cand["first"])
        hits = [p for p in hits if first and (slug(p["first"]) == first or slug(p["name"]).split()[0] == first)]
    return hits[0] if len(hits) == 1 else None


BULK_STATES = ("TX", "CA", "IL", "FL")
finance, stats = {}, {}
SKIP = {x for a in sys.argv if a.startswith("--skip=") for x in a[7:].upper().split(",")}  # e.g. --skip=IL while a download is pending
for st, fn in [x for x in (("WA", washington), ("HI", hawaii), ("TX", texas), ("CA", california), ("IL", illinois)) if x[0] not in SKIP]:
    print("fetching", st)
    cands = fn()
    n = 0
    if st in BULK_STATES:
        # One 2025-26 window, possibly several committees per official (re-election, officeholder account): add them up.
        mine = collections.defaultdict(list)
        for c in cands:
            p = match(st, c, anywhere=True)
            if p:
                mine[p["id"]].append(c)
        for pid, cs in mine.items():
            m = cs[0] if len(cs) == 1 else {**cs[0], "total": sum(c["total"] for c in cs), "n": sum(c["n"] for c in cs),
                                            "kinds": sum((c["kinds"] for c in cs), collections.Counter()),
                                            "orgs": sum((c["orgs"] for c in cs), collections.Counter()),
                                            "emp": sum((c["emp"] for c in cs), collections.Counter()),
                                            "org_kind": {k: v for c in cs for k, v in c["org_kind"].items()},
                                            "committee_names": [n for c in cs for n in c.get("committee_names", [])]}
            finance[pid] = summarize(m, st, SOURCES[st])
    for c in sorted(cands, key=lambda c: (c["cycle"], c["total"])) if st not in BULK_STATES else []:  # a later or bigger campaign wins
        p = match(st, c)
        if p:
            finance[p["id"]] = summarize(c, st, SOURCES[st]); n += 1
    officials = sum(1 for p in by_state[st] if p["status"] != "departing")
    stats[st] = {"candidates": len(cands), "matched": len({k for k, v in finance.items() if v["st"] == st}), "officials": officials}
print("fetching NY")
for c in new_york(people):
    finance[c["pid"]] = summarize(c, "NY", SOURCES["NY"])
stats["NY"] = {"matched": sum(1 for v in finance.values() if v["st"] == "NY"), "officials": len(by_state["NY"])}

(RAW / "state_finance.json").write_text(json.dumps({"generated": TODAY, "states": {k: {**SOURCES[k], **stats[k]} for k in SOURCES if k in stats},
                                                     "finance": finance}))
print(json.dumps(stats))
print("with health money", sum(1 for v in finance.values() if v["health_total"]),
      "health $", sum(v["health_total"] for v in finance.values()))
