"""Parses 2026 House and Senate general-election results out of Wikipedia's
'2026 United States House/Senate elections' wikitext (saved in data/raw/)."""
import json, re

from roster120 import STATES

ABBR = set(STATES.values())
PARTY = {"Democratic": "D", "Republican": "R", "Independent": "I", "Democratic–Farmer–Labor": "D", "DFL": "D"}


def _clean(x):
    x = re.sub(r"<ref[^>]*?/>|<ref.*?</ref>", "", x, flags=re.S)
    x = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", x)
    x = re.sub(r"\{\{[^{}]*\}\}", "", x)
    return re.sub(r"'''|''|<br\s*/?>", " ", x).strip()


def _candidates(cell):
    out = []
    for line in cell.split("\n"):
        line = line.strip()
        if not re.match(r"^[*|]", line) or "Party stripe" not in line:
            continue
        won = bool(re.search(r"\{\{\s*aye\s*\}\}", line, re.I))
        m = re.search(r"\(([^()]+)\)\s*(?:([\d.]+)%)?\s*$", _clean(line))
        if not m:
            continue
        name = _clean(line[:line.rfind("(")]).lstrip("*| ").strip()
        out.append({"name": name, "party": PARTY.get(m.group(1).strip(), m.group(1).strip()),
                    "pct": float(m.group(2)) if m.group(2) else None, "won": won})
    return out


def _result(cells):
    for c in cells:
        t = _clean(c)
        if re.search(r"(reelected|re-elected|retired|lost|hold|gain|New member|elected|Incumbent)", t, re.I) and "%" not in t:
            return re.sub(r"\s+", " ", t.split("|")[-1]).strip()
    return ""


def house(path):
    t = json.load(open(path))["parse"]["wikitext"]["*"]
    t = t[re.search(r"\n==\s*Alabama\s*==", t).start():]  # skip the special-elections tables above
    races = []
    for row in re.split(r"\n\|-", t):
        u = re.search(r"^\s*!\s*\{\{ushr\|([A-Z]{2})\|(\w+)\|X\}\}", row.strip())
        if not u or u.group(1) not in ABBR:
            continue
        cells = re.split(r"\n[|!]", "\n" + row.strip())
        pvi = re.search(r"\{\{shading PVI\|([DRE])\|?(\d*)\}\}", row)
        cands = _candidates(row)
        if not cands:
            continue
        races.append({
            "state": u.group(1), "district": 0 if u.group(2) in ("AL", "at-large") else int(u.group(2)),
            "pvi": (pvi.group(1) + "+" + pvi.group(2)) if pvi and pvi.group(2) else ("EVEN" if pvi else ""),
            "result": _result(cells), "candidates": cands,
        })
    return races


def senate(path):
    t = json.load(open(path))["parse"]["wikitext"]["*"]
    start = t.find("Elections leading to the next Congress")
    special = t.find("Special elections during the preceding Congress")
    races = []
    for part, is_special in [(t[special:start], True), (t[start:], False)]:
        for row in re.split(r"\n\|-", part):
            h = re.search(r"^\s*!\s*(?:\[\[[^|\]]*\|)?([A-Z][A-Za-z .]+?)(?:\]\])?\s*(?:<br\s*/?>.*|\{\{small\|[^}]*\}\})?\s*$",
                          row.strip().split("\n")[0])
            if not h:
                continue
            st = STATES.get(h.group(1).replace("(special)", "").strip())
            cands = _candidates(row)
            if not st or not cands:
                continue
            races.append({"state": st, "special": is_special or "special" in row.split("\n")[0].lower(),
                          "result": _result(re.split(r"\n[|!]", "\n" + row.strip())), "candidates": cands})
        if not is_special:
            break
    seen, out = set(), []
    for r in races:  # a special can appear in both tables; keep the first
        k = (r["state"], r["special"])
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


if __name__ == "__main__":
    import collections, sys
    h = house(sys.argv[1]); s = senate(sys.argv[2])
    print("house", len(h), "senate", len(s))
    print("house no winner", [(r["state"], r["district"]) for r in h if not any(c["won"] for c in r["candidates"])])
    print("senate", [(r["state"], r["special"], [c["name"] for c in r["candidates"] if c["won"]], r["result"][:40]) for r in s])
    print(collections.Counter(len(r["candidates"]) for r in h))
    print(h[0], h[100])
