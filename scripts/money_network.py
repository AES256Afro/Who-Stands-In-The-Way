#!/usr/bin/env python3
"""Money network for the 2025-26 cycle from FEC bulk data. Writes public/money/:

  committees.json  notable PACs, super PACs, party and leadership committees: totals, who they back or
                   attack (direct gifts + independent expenditures), their biggest donors (people and
                   organizations, gifts of $1,000+), and money moving to and from other committees.
  donors.json      people who gave $1,000,000+ in itemized gifts this cycle, and organizations that gave
                   $250,000+, with the committees they funded.

Gift-level rules (to avoid double counting): memo entries are skipped; conduit pass-throughs (ActBlue,
WinRed: transaction type 24T/24I) are skipped and the gift is counted where the recipient reports it;
joint-fundraising re-allocations (15J) are skipped because the gift is counted at the joint committee.
Run after build_seed.py (it reads seed/seed.json to link FEC candidates to profiles).
"""
import collections, csv, io, json, pathlib, re, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "money"
CONDUITS = {"C00401224", "C00694323"}  # ActBlue, WinRed
TYPE = {"O": "Super PAC", "U": "Single-candidate super PAC", "V": "Hybrid PAC", "W": "Hybrid PAC",
        "N": "PAC", "Q": "PAC", "X": "Party committee", "Y": "Party committee", "Z": "Party committee",
        "I": "Independent spender", "E": "Electioneering spender", "C": "Communication cost filer"}
num = lambda x: float(x or 0) if re.match(r"^-?[\d.]+$", str(x or "0")) else 0.0

# ---------------------------------------------------------------- committees and candidates
cm = {}
for line in open(RAW / "cm.txt", encoding="latin-1"):
    f = line.rstrip("\n").split("|")
    cm[f[0]] = {"name": f[1], "dsgn": f[8], "tp": f[9], "party": f[10], "org": f[13], "cand": f[14] if len(f) > 14 else ""}
webk = {}
for line in open(RAW / "webk26.txt", encoding="latin-1"):
    f = line.rstrip("\n").split("|")
    webk[f[0]] = {"receipts": num(f[5]), "indiv": num(f[7]), "from_cmte": num(f[8]), "disb": num(f[12]),
                  "to_cmte": num(f[22]), "ie": num(f[23]), "coh": num(f[19])}
cand_info = {}
for line in open(RAW / "weball26.txt", encoding="latin-1"):
    f = line.rstrip("\n").split("|")
    cand_info[f[0]] = {"name": f[1], "party": {"DEM": "D", "REP": "R", "DFL": "D"}.get(f[4], "I" if f[4] else ""), "st": f[18], "dist": f[19]}
seed = json.load(open(ROOT / "seed" / "seed.json", encoding="utf-8"))
pid_of = {}
for p in seed["politicians"]:
    for fid in (p.get("fec_ids") or "").split(","):
        if fid.strip():
            pid_of[fid.strip()] = p["id"]
lpacs = {c["id"]: c for c in json.load(open(RAW / "leadership_pacs.json"))}


def who(cand):
    i = cand_info.get(cand, {})
    return {"pid": pid_of.get(cand), "name": i.get("name", cand), "party": i.get("party", ""), "st": i.get("st", "")}


# ---------------------------------------------------------------- direct gifts to candidates and outside spending
direct = collections.defaultdict(lambda: collections.defaultdict(float))  # cmte -> cand -> $
for line in open(RAW / "itpas2.txt", encoding="latin-1"):
    f = line.rstrip("\n").split("|")
    if len(f) >= 17 and f[5] in ("24K", "24Z") and f[16]:
        direct[f[0]][f[16]] += num(f[14])
ie_latest = {}
with open(RAW / "independent_expenditure_2026.csv", encoding="latin-1", newline="") as fh:
    for r in csv.DictReader(fh):
        if r["cand_id"] and num(r["exp_amo"]) <= 100_000_000:  # junk filings report absurd sums (largest real one: ~$28M)
            k = (r["spe_id"], r["tran_id"])
            if k not in ie_latest or int(r["file_num"] or 0) >= int(ie_latest[k]["file_num"] or 0):
                ie_latest[k] = r
ie = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0, 0.0]))  # cmte -> cand -> [for, against]
ie_names = {}
for r in ie_latest.values():
    so = (r["sup_opp"] or "").upper()[:1]
    if so in ("S", "O"):
        ie[r["spe_id"]][r["cand_id"]][0 if so == "S" else 1] += num(r["exp_amo"])
        ie_names[r["spe_id"]] = r["spe_nam"]

# ---------------------------------------------------------------- committee-to-committee money
edges = collections.defaultdict(float)  # (from, to) -> $
with zipfile.ZipFile(RAW / "oth26.zip") as z, z.open("itoth.txt") as fh:
    for line in io.TextIOWrapper(fh, encoding="latin-1"):
        f = line.rstrip("\n").split("|")
        if len(f) < 19 or f[18] == "X" or not f[15] or not f[5].startswith("18"):
            continue
        if f[15] in CONDUITS or f[0] in CONDUITS:
            continue
        edges[(f[15], f[0])] += num(f[14])

# Which committees get a card: big spenders, big receivers, every outside spender, and every leadership PAC.
notable = set()
for cid, w in webk.items():
    if cid in CONDUITS or cm.get(cid, {}).get("tp") in ("H", "S", "P"):
        continue
    if w["receipts"] >= 500_000 or w["ie"] >= 50_000:
        notable.add(cid)
notable |= {c for c in ie if sum(a + b for a, b in ie[c].values()) >= 25_000}
notable |= set(lpacs)
notable -= CONDUITS
print("notable committees", len(notable))

# ---------------------------------------------------------------- individuals and organizations (2 passes)
SUFFIX = re.compile(r"\b(JR|SR|II|III|IV|MR|MRS|MS|DR)\b|[.,]")


def donor_key(name, state, entity):
    n = re.sub(r"\s+", " ", SUFFIX.sub(" ", name.upper())).strip()
    if entity == "IND":
        last, _, first = n.partition(" ")
        if "," in name:
            last, _, first = name.upper().partition(",")
            last = re.sub(r"[^A-Z \-']", "", last).strip()
            first = (SUFFIX.sub(" ", first).split() or [""])[0]
        return f"I|{last}|{first}|{state}"
    return f"O|{n}"


def rows():
    with zipfile.ZipFile(RAW / "indiv26.zip") as z, z.open("itcont.txt") as fh:
        for line in io.TextIOWrapper(fh, encoding="latin-1"):
            f = line.rstrip("\n").split("|")
            if len(f) < 19 or f[18] == "X" or f[0] in CONDUITS:
                continue
            tp = f[5]
            if tp not in ("10", "11", "15", "15C", "15E", "22Y"):
                continue
            amt = num(f[14])
            if tp == "22Y":
                amt = -abs(amt)
            if abs(amt) < 1000:
                continue
            yield f, amt


tot = collections.Counter()
for f, amt in rows():
    tot[donor_key(f[7], f[9], f[6])] += amt
big = {k for k, v in tot.items() if (k.startswith("I|") and v >= 1_000_000) or (k.startswith("O|") and v >= 250_000)}
print("megadonors", sum(1 for k in big if k[0] == "I"), "big organizations", sum(1 for k in big if k[0] == "O"))

donor_to = collections.defaultdict(lambda: collections.Counter())
donor_meta = {}
cmte_donors = collections.defaultdict(lambda: collections.Counter())
key_meta = {}
for f, amt in rows():
    k = donor_key(f[7], f[9], f[6])
    if k in big:
        donor_to[k][f[0]] += amt
        m = donor_meta.setdefault(k, {"n": f[7].strip(), "city": f[8].strip(), "st": f[9], "emp": collections.Counter(), "occ": collections.Counter(), "kind": f[6]})
        if f[11]:
            m["emp"][f[11].strip()] += 1
        if f[12]:
            m["occ"][f[12].strip()] += 1
    if f[0] in notable:
        cmte_donors[f[0]][k] += amt
        if k not in key_meta:
            key_meta[k] = (f[7].strip(), f[6], f[9])

# ---------------------------------------------------------------- assemble
OUT.mkdir(parents=True, exist_ok=True)
in_edges = collections.defaultdict(list)
out_edges = collections.defaultdict(list)
for (a, b), v in edges.items():
    if v >= 5000:
        out_edges[a].append((b, v))
        in_edges[b].append((a, v))

committees = {}
for cid in notable:
    c = cm.get(cid, {"name": ie_names.get(cid, cid), "tp": "", "party": "", "org": "", "dsgn": ""})
    w = webk.get(cid, {})
    rec = collections.defaultdict(lambda: [0.0, 0.0, 0.0])  # direct, for, against
    for cand, v in direct.get(cid, {}).items():
        rec[cand][0] += v
    for cand, (s, o) in ie.get(cid, {}).items():
        rec[cand][1] += s
        rec[cand][2] += o
    split = {"forD": 0.0, "forR": 0.0, "agD": 0.0, "agR": 0.0, "other": 0.0}
    recl = []
    for cand, (d, s, o) in rec.items():
        wq = who(cand)
        if wq["party"] == "D":
            split["forD"] += d + s; split["agD"] += o
        elif wq["party"] == "R":
            split["forR"] += d + s; split["agR"] += o
        else:
            split["other"] += d + s + o
        recl.append([wq["pid"], wq["name"], wq["party"], wq["st"], round(d), round(s), round(o)])
    recl.sort(key=lambda r: -(r[4] + r[5] + r[6]))
    donors = [[key_meta[k][0], key_meta[k][1], round(v), k] for k, v in cmte_donors[cid].most_common(12) if v > 0]
    sponsor = None
    if cid in lpacs:
        for s in lpacs[cid]["sponsors"]:
            sponsor = sponsor or pid_of.get(s)
    committees[cid] = {
        "n": c["name"], "t": "Leadership PAC" if cid in lpacs else TYPE.get(c["tp"], "Committee"),
        "p": c.get("party", ""), "o": c.get("org", ""), "lead": sponsor,
        "r": round(w.get("receipts", 0)), "i": round(w.get("indiv", 0)), "c": round(w.get("from_cmte", 0)),
        "d": round(w.get("disb", 0)), "x": round(sum(s + o for s, o in ie.get(cid, {}).values())),
        "g": round(sum(direct.get(cid, {}).values())), "s": {k: round(v) for k, v in split.items()},
        "rec": recl[:15], "donors": donors,
        "from": [[a, round(v)] for a, v in sorted(in_edges[cid], key=lambda x: -x[1])[:10]],
        "to": [[b, round(v)] for b, v in sorted(out_edges[cid], key=lambda x: -x[1])[:10]],
    }
# names for committees that only appear as connections
names = {cid: cm[cid]["name"] for c in committees.values() for cid, _ in c["from"] + c["to"] if cid in cm and cid not in committees}

donors = []
for k in big:
    m = donor_meta.get(k)
    if not m:
        continue
    kind = "person" if m["kind"] == "IND" else "organization" if m["kind"] == "ORG" else "committee"
    donors.append({"k": k, "n": m["n"], "kind": kind, "city": m["city"], "st": m["st"],
                   "emp": (m["emp"].most_common(1) or [("", 0)])[0][0], "occ": (m["occ"].most_common(1) or [("", 0)])[0][0],
                   "total": round(sum(donor_to[k].values())),
                   "to": [[cid, round(v)] for cid, v in donor_to[k].most_common(15) if v > 0]})
donors.sort(key=lambda d: -d["total"])
for d in donors:
    for cid, _ in d["to"]:
        if cid not in committees and cid in cm:
            names[cid] = cm[cid]["name"]

(OUT / "committees.json").write_text(json.dumps({"committees": committees, "names": names}, separators=(",", ":")))
(OUT / "donors.json").write_text(json.dumps(donors, separators=(",", ":")))
print("committees", len(committees), "bytes", (OUT / "committees.json").stat().st_size,
      "| donors", len(donors), "bytes", (OUT / "donors.json").stat().st_size)
print("top donors:", [(d["n"], d["total"]) for d in donors[:12]])
