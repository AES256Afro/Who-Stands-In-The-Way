#!/usr/bin/env python3
"""Track AIPAC's published "Israel Lobby Total" per member of Congress (career, all pro-Israel PACs and
their outside spending, from FEC data; https://www.trackaipac.com/tracker). One request for the tracker
page, which lists everyone. Matches each card to our people by state, seat and last name.
Writes data/raw/trackaipac.json {politician_id: {total, url, office, status}} where status is "funded",
"none" (no pro-Israel PAC money) or "rejects" (Track AIPAC lists them as rejecting AIPAC).
"""
import datetime, html, json, pathlib, re, subprocess, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
BASE = "https://www.trackaipac.com"

page = subprocess.run(["curl", "-sfL", "-A", "who-stands-in-the-way/1.0", BASE + "/tracker"], capture_output=True, check=True).stdout.decode("utf-8", "ignore")
(RAW / "research").mkdir(exist_ok=True)
(RAW / "research" / "trackaipac_tracker.html").write_text(page)

people = [p for p in json.load(open(ROOT / "seed" / "seed.json"))["politicians"] if p.get("level", "federal") != "state" or p.get("chamber") == "governor"]


STATES = {"Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
          "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY",
          "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
          "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
          "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
          "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
          "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"}


def norm(s):
    return re.sub(r"[^a-z ]", " ", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).split()


cards = re.split(r'<li id="person-', page)[1:]
out, unmatched = {}, []
for c in cards:
    slug = c.split('"', 1)[0]
    name_m = re.search(r'aria-label="([^"]+?), (?:Democrat|Republican|Independent|[^"]*)"', c)
    name = html.unescape(name_m.group(1)) if name_m else ""
    office = html.unescape(re.sub(r"<[^>]+>", "", (re.search(r'__office"[^>]*>(.*?)</p>', c) or [None, ""])[1])).strip()
    tot = re.search(r"Israel Lobby Total</dt><dd[^>]*>\$([\d,]+)", c)
    if tot:
        status, total = "funded", int(tot.group(1).replace(",", ""))
    elif re.search(r"rejects AIPAC|reject(?:s|ed) AIPAC", c, re.I):
        status, total = "rejects", 0
    else:
        status, total = "none", 0
    href = re.search(r'href="(/tracker/people/[^"?]+)', c)
    # slug: <kind>-<name words>-<st>-<sen|NN|al>-<party>, e.g. member-chuck-schumer-ny-sen-d
    m = re.search(r"-([a-z]{2})-(sen|\d+|al|at-large)-([a-z])$", slug)
    st, seat = (m.group(1).upper(), m.group(2)) if m else (None, None)
    last = (norm(name) or [""])[-1]
    cand = [p for p in people if st and p["state"] == st
            and ((seat == "sen" and p["chamber"] == "senate") or (seat not in ("sen", None) and p["chamber"] == "house"
                 and str(p.get("district") or 0) == ("0" if seat in ("al", "at-large") else str(int(seat)))))]
    hit = [p for p in cand if last and last in norm(p["name"])]
    # District numbers changed with the 2027 maps and some members moved chambers: fall back to the name,
    # within the state when the card says which.
    if len(hit) != 1 and name:
        nm = norm(name)
        hit = [p for p in people if (not st or p["state"] == st) and norm(p["name"])[-1:] == nm[-1:] and norm(p["name"])[:1] == nm[:1]]
    # A few cards carry no name, only the office ("U.S. Senator-elect for Montana").
    if len(hit) != 1 and not name:
        om = re.search(r"Senator-elect for (.+)$", office)
        if om:
            hit = [p for p in people if p["chamber"] == "senate" and p.get("status") == "incoming" and STATES.get(om.group(1)) == p["state"]]
    if len(hit) == 1:
        out[hit[0]["id"]] = {"total": total, "status": status, "office": office, "name": name,
                             "url": BASE + (href.group(1) if href else "/tracker")}
    else:
        unmatched.append((slug, name, office))

json.dump({"as_of": datetime.date.today().isoformat(), "source": BASE + "/tracker", "people": out}, open(RAW / "trackaipac.json", "w"))
print("cards", len(cards), "matched", len(out), "unmatched", len(unmatched))
for u in unmatched[:40]:
    print("  unmatched:", u)
