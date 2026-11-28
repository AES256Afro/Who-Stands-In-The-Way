#!/usr/bin/env python3
"""Career pro-Israel PAC money per member, every FEC cycle from 1980, for the committees on Track AIPAC's
published list (data/raw/research/trackaipac_pacs.csv: AIPAC PAC, United Democracy Project, DMFI, RJC,
NORPAC, JACPAC, Preserve America and others, 66 in all).

Per member and committee:
  direct       gifts to their campaigns (24K/24Z in the FEC committee-to-candidate file, pas2)
  earmarked    donations individuals routed through the committee (15E in the individual contributions
               file, 2022-2026 only; earlier earmarks are counted only where the committee reported them
               itself as "EARMARK" gifts in pas2)
  ie_for       ads and other outside spending for them (24E)
  ie_against   outside spending against them (24A)
  vs_opponents outside spending against other candidates for the same seat in the same cycle (24A)

Writes data/raw/israel_career.json keyed by politician id. Totals only, no donor names.
Inputs (data/raw/bulk/, git-ignored): pas2/pas2YY.zip, cn/cnYY.zip, ccl/cclYY.zip, indivYY.zip
(indiv26 is read from data/raw/indiv26.zip). Run after the seed people exist (seed/seed.json).
"""
import collections, csv, io, json, pathlib, sys, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW, BULK = ROOT / "data" / "raw", ROOT / "data" / "raw" / "bulk"
AIPAC = {"C00797670", "C00799031"}  # AIPAC PAC and its super PAC, United Democracy Project
EARMARK_CYCLES = () if "--no-earmarks" in sys.argv else (2022, 2024, 2026)  # --no-earmarks: quick run from pas2 alone

pacs = {r["ID"].strip(): r["PAC Name"].strip() for r in csv.DictReader(open(RAW / "research" / "trackaipac_pacs.csv")) if r["ID"].strip()}

people = json.load(open(ROOT / "seed" / "seed.json"))["politicians"]
owner = {}
for p in people:
    for c in (p.get("fec_ids") or "").replace(" ", "").split(","):
        if c:
            owner[c] = p["id"]

money = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.Counter()))
cycles = collections.defaultdict(set)
seat_of = {}                                   # (cycle, cand) -> seat
against_seat = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))  # (cycle, seat) -> cand -> cmte -> $


def amount(x):
    try:
        return float(x or 0)
    except ValueError:
        return 0.0


def lines(path, member):
    with zipfile.ZipFile(path) as z, z.open(member) as fh:
        yield from io.TextIOWrapper(fh, encoding="latin-1")


for cycle in range(1980, 2027, 2):
    yy = f"{cycle % 100:02d}"
    cn = BULK / "cn" / f"cn{yy}.zip"
    if cn.exists():
        for line in lines(cn, "cn.txt"):
            f = line.split("|")
            if len(f) > 6 and f[5] in ("H", "S"):
                seat_of[(cycle, f[0])] = (f[5], f[4], f[6] if f[5] == "H" else "")
    pas = BULK / "pas2" / f"pas2{yy}.zip"
    if not pas.exists():
        print("missing", pas.name)
        continue
    for line in lines(pas, "itpas2.txt"):
        f = line.rstrip("\n").split("|")
        if len(f) < 17 or f[0] not in pacs or not f[16]:
            continue
        tp, cand, amt = f[5], f[16], amount(f[14])
        memo = f[20].upper() if len(f) > 20 else ""
        if tp in ("24K", "24Z"):
            # Conduits list some forwarded donations as gifts; for 2022+ those come from the individual file instead.
            if "EARMARK" in memo and cycle in EARMARK_CYCLES:
                continue
            key = "earmarked" if "EARMARK" in memo else "direct"
        elif tp == "24E":
            key = "ie_for"
        elif tp == "24A":
            key = "ie_against"
            seat = seat_of.get((cycle, cand))
            if seat:
                against_seat[(cycle, seat)][cand][f[0]] += amt
        else:
            continue
        if cand in owner:
            money[owner[cand]][f[0]][key] += amt
            cycles[owner[cand]].add(cycle)

# Earmarked donations routed through these committees, 2022-2026, from the recipients' own reports.
for cycle in EARMARK_CYCLES:
    yy = f"{cycle % 100:02d}"
    cand_of = {}
    ccl = BULK / "ccl" / f"ccl{yy}.zip"
    for line in lines(ccl, "ccl.txt"):
        f = line.split("|")
        if len(f) > 3:
            cand_of.setdefault(f[3], f[0])
    src = RAW / "indiv26.zip" if cycle == 2026 else BULK / f"indiv{yy}.zip"
    if not src.exists():
        print("missing", src.name, "- earmarks for", cycle, "left out")
        continue
    n = 0
    for line in lines(src, "itcont.txt"):
        f = line.split("|", 20)
        if len(f) < 19 or f[15] not in pacs or f[5] not in ("15E", "22Y") or f[0] in pacs:
            continue
        if f[18] == "X":  # memo entries repeat a parent row
            continue
        cand = cand_of.get(f[0])
        if cand not in owner:
            continue
        amt = amount(f[14])
        money[owner[cand]][f[15]]["earmarked"] += -abs(amt) if f[5] == "22Y" else amt
        cycles[owner[cand]].add(cycle)
        n += 1
    print(cycle, "earmark rows", n)

# Outside spending against the other candidates in races these members ran in.
by_seat_member = collections.defaultdict(set)
for (cycle, cand), seat in seat_of.items():
    if cand in owner:
        by_seat_member[(cycle, seat)].add(owner[cand])
for key, targets in against_seat.items():
    members = by_seat_member.get(key, set())
    for pid in members:
        for cand, by_cmte in targets.items():
            if owner.get(cand) == pid:
                continue
            for cmte, amt in by_cmte.items():
                money[pid][cmte]["vs_opponents"] += amt
                cycles[pid].add(key[0])

FIELDS = ("direct", "earmarked", "ie_for", "ie_against", "vs_opponents")
out = {}
for pid, by_cmte in money.items():
    rows = []
    for cmte, c in by_cmte.items():
        # Refunds and corrections can leave a small negative balance; count those as nothing.
        r = {"id": cmte, "name": pacs[cmte], **{k: max(0.0, round(c[k], 2)) for k in FIELDS}}
        if any(r[k] for k in FIELDS):
            rows.append(r)
    if not rows:
        continue
    rows.sort(key=lambda r: -(r["direct"] + r["earmarked"] + r["ie_for"] + r["vs_opponents"]))
    sum_ = lambda k, pick=lambda r: True: round(sum(r[k] for r in rows if pick(r)), 2)
    isA = lambda r: r["id"] in AIPAC
    out[pid] = {
        "first_cycle": min(cycles[pid]), "last_cycle": max(cycles[pid]),
        "for": round(sum_("direct") + sum_("earmarked") + sum_("ie_for"), 2),
        "vs_opponents": sum_("vs_opponents"), "against": sum_("ie_against"),
        "aipac": {k: sum_(k, isA) for k in FIELDS},
        "pacs": rows,
    }
(RAW / "israel_career.json").write_text(json.dumps(out))
print("members with pro-Israel PAC money", len(out))
