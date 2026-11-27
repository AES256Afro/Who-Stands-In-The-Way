#!/usr/bin/env python3
"""Totals itemized individual donations from employees of health-industry companies, per candidate
committee and per leadership PAC, from the FEC individual contributions file (data/raw/indiv26.zip,
streamed). Writes data/raw/emp_agg.json.

Only the donor's EMPLOYER is used to classify, and results are kept as totals by employer: no donor
names are stored. (Federal law bars using individual contributor details to solicit contributions.)
Deliberately excluded: nurses, and staff of nonprofit hospitals and health systems, whose giving
says little about industry interests and who often support Medicare for All.
"""
import collections, io, json, pathlib, re, zipfile

RAW = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"

EMPLOYER_SECTORS = [
    ("insurance", re.compile(
        r"UNITEDHEALTH|UNITED HEALTH ?GROUP|UNITED ?HEALTHCARE|OPTUM|ELEVANCE|\bANTHEM\b|\bCIGNA\b|EVERNORTH|HUMANA|"
        r"\bAETNA\b|CVS HEALTH|CVS CAREMARK|CENTENE|MOLINA HEALTH|BLUE ?CROSS|BLUE ?SHIELD|\bBCBS|"
        r"HEALTH CARE SERVICE CORP|HIGHMARK|WELLCARE|OSCAR HEALTH|EXPRESS SCRIPTS|GUIDEWELL|CAREFIRST|"
        r"CAMBIA HEALTH|KAISER (?:FOUNDATION )?HEALTH PLAN|AMERICA.?S HEALTH INSURANCE PLANS|\bAHIP\b|"
        r"PRIME THERAPEUTICS|MEDIMPACT|CLOVER HEALTH|ALIGNMENT HEALTH|BRIGHT HEALTH")),
    ("pharma", re.compile(
        r"PFIZER|\bMERCK\b|ABBVIE|\bAMGEN\b|ELI LILLY|LILLY (?:AND|&) CO|\bLILLY USA|JOHNSON (?:&|AND) JOHNSON|"
        r"JANSSEN|BRISTOL[- ]?MYERS|NOVARTIS|SANOFI|GLAXOSMITHKLINE|\bGSK\b|ASTRAZENECA|GILEAD|NOVO NORDISK|"
        r"\bBAYER\b|TAKEDA|REGENERON|VERTEX PHARM|BIOGEN|\bTEVA\b|PHARMACEUTIC|\bPHARMA\b|BIOPHARM|"
        r"GENENTECH|BOEHRINGER|ASTELLAS|OTSUKA|VIATRIS|MODERNA|DAIICHI|\bEISAI\b|ABBOTT LAB|"
        r"ALKERMES|EMD SERONO|LUNDBECK|MALLINCKRODT|\bROCHE\b|MCKESSON|CARDINAL HEALTH|CENCORA|"
        r"AMERISOURCE|ALNYLAM|INCYTE|BIOMARIN|JAZZ PHARM|UNITED THERAPEUTICS|PHRMA\b")),
    ("devices", re.compile(
        r"MEDTRONIC|ADVAMED|BOSTON SCIENTIFIC|STRYKER|BECTON DICKINSON|\bBD\b MEDICAL|BAXTER (?:INTERNATIONAL|HEALTHCARE)|ZIMMER|"
        r"INTUITIVE SURGICAL|EDWARDS LIFESCIENCES|HOLOGIC|GE HEALTHCARE|SIEMENS HEALTHINEERS|DEXCOM|"
        r"RESMED|SMITH (?:&|AND) NEPHEW|INSULET|TELEFLEX")),
    ("providers", re.compile(
        r"DAVITA|FRESENIUS|LABCORP|LABORATORY CORP|QUEST DIAGNOSTICS|ENVISION HEALTH|TEAMHEALTH|"
        r"GENESIS HEALTHCARE|BROOKDALE SENIOR|AMEDISYS|ENCOMPASS HEALTH|SELECT MEDICAL|U\.?S\.? RENAL|"
        r"\bHCA\b|HCA HEALTHCARE|TENET HEALTH|COMMUNITY HEALTH SYSTEMS|UNIVERSAL HEALTH SERVICES|"
        r"LIFEPOINT|ARDENT HEALTH|ACADIA HEALTHCARE|SURGERY PARTNERS|SCA HEALTH|OAK STREET HEALTH|AGILON")),
]
SKIP_EMPLOYER = re.compile(r"^(N/?A|NONE|SELF|SELF[- ]EMPLOYED|RETIRED|NOT EMPLOYED|UNEMPLOYED|HOMEMAKER|INFORMATION REQUESTED.*)$")
SKIP_OCCUPATION = re.compile(r"NURS|\bRN\b|\bLPN\b|\bCNA\b")
SUFFIX = re.compile(r"[.,]|\b(INC|INCORPORATED|LLC|L L C|CORP|CORPORATION|CO|COMPANY|LTD|LP|PLC|USA|US|THE)\b")


def sector(employer):
    for name, rx in EMPLOYER_SECTORS:
        if rx.search(employer):
            return name
    return None


def canon(employer):
    return re.sub(r"\s+", " ", SUFFIX.sub(" ", employer)).strip() or employer


# Which committees to keep: each candidate's authorized committees, and leadership PACs.
cand_of = {}
for line in open(RAW / "ccl.txt", encoding="latin-1"):
    f = line.rstrip("\n").split("|")
    if len(f) >= 4 and f[3]:
        cand_of[f[3]] = f[0]
lpac = {c["id"] for c in json.load(open(RAW / "leadership_pacs.json"))}

agg = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0, 0, ""]))
kept = total_lines = 0
with zipfile.ZipFile(RAW / "indiv26.zip") as z:
    name = "itcont.txt"  # the full file; the archive also holds the same rows split by date
    with z.open(name) as fh:
        for line in io.TextIOWrapper(fh, encoding="latin-1"):
            total_lines += 1
            f = line.rstrip("\n").split("|")
            if len(f) < 19:
                continue
            cmte = f[0]
            if cmte not in cand_of and cmte not in lpac:
                continue
            # 15J = a donor's share of money passed on by a joint fundraising committee. Those rows are
            # memo entries (the transfer itself is not counted here), so keep them even when marked "X".
            if f[5] not in ("15", "15E", "15J", "22Y") or (f[18] == "X" and f[5] != "15J"):
                continue
            emp = f[11].strip().upper()
            if not emp or SKIP_EMPLOYER.match(emp) or SKIP_OCCUPATION.search(f[12].upper()):
                continue
            sec = sector(emp)
            if not sec:
                continue
            try:
                amt = float(f[14] or 0)
            except ValueError:
                continue
            if f[5] == "22Y":  # refund to the donor
                amt = -abs(amt)
            key = canon(emp)
            cell = agg[cmte][key]
            cell[0] += amt
            cell[1] += 1 if amt > 0 else 0
            cell[2] = sec
            kept += 1

out = {"by_committee": {}, "candidate_of": {}}
for cmte, emps in agg.items():
    rows = [{"employer": k, "sector": v[2], "amount": round(v[0], 2), "count": v[1]} for k, v in emps.items() if v[0] > 0]
    if rows:
        out["by_committee"][cmte] = sorted(rows, key=lambda r: -r["amount"])
        if cmte in cand_of:
            out["candidate_of"][cmte] = cand_of[cmte]
(RAW / "emp_agg.json").write_text(json.dumps(out))
print("read", total_lines, "lines from", name, "; matching rows", kept, "committees", len(out["by_committee"]),
      "total", round(sum(r["amount"] for rows in out["by_committee"].values() for r in rows)))
