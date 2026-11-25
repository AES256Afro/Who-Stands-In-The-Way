"""Parses the member list out of Wikipedia's '120th United States Congress' wikitext."""
import json, re

STATES = {"Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
          "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
          "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
          "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
          "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
          "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
          "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
          "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
          "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
          "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC", "Puerto Rico": "PR", "Guam": "GU",
          "American Samoa": "AS", "Northern Mariana Islands": "MP", "United States Virgin Islands": "VI",
          "U.S. Virgin Islands": "VI", "Virgin Islands": "VI"}
PARTY = {"D": "D", "DFL": "D", "R": "R", "I": "I", "PPD/D": "D", "PNP/R": "R", "PNP/D": "D", "PPD": "D"}


def parse(path):
    d = json.load(open(path))["parse"]
    t = d["wikitext"]["*"]
    t = t[re.search(r"==\s*Members\s*==", t).start():]
    nxt = re.search(r"\n==[^=]", t[5:])
    if nxt:
        t = t[:nxt.start() + 5]
    chamber = state = None
    rows = []
    for line in t.split("\n"):
        m = re.match(r"^(=+)\s*(.*?)\s*=+\s*$", line)
        if m:
            title = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", m.group(2))
            if len(m.group(1)) == 3:
                chamber = "senate" if "Senate" in title else "house"
            elif len(m.group(1)) == 4:
                state = title
            continue
        if not line.startswith(":"):
            continue
        body = re.sub(r"<ref[^>]*?/>|<ref.*?</ref>", "", line)
        row = {"chamber": chamber, "outgoing": "(outgoing)" in body, "undecided": False, "voting": 1}
        u = re.search(r"\{\{ushr\|([^|]+)\|([^|}]+)", body)
        if u:
            row["state"] = STATES.get(u.group(1).strip())
            row["district"] = 0 if u.group(2) == "AL" else int(u.group(2))
            if state == "Non-voting members":
                row["voting"] = 0
            tail = body[u.end():]
            tail = tail[tail.index("}}") + 2:]
        else:
            c = re.search(r"\}\}\s*(\d)\.", body)
            if not c:
                continue
            row["state"] = STATES.get(state)
            row["class"] = int(c.group(1))
            tail = body[c.end():]
        link = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", tail)
        if not link:
            row["undecided"] = True
            rows.append(row)
            continue
        p = re.search(r"\(([\w/]+)\)", tail[link.end():])
        row["wiki"] = link.group(1).strip()
        row["name"] = (link.group(2) or link.group(1)).strip()
        row["party"] = PARTY.get(p.group(1) if p else "", "I")
        rows.append(row)
    return rows


def revid(path):
    return json.load(open(path))["parse"].get("revid")
