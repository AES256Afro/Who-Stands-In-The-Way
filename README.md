# Who Stands In The Way

Tracks where every member of the Congress sworn in on January 3, 2027 (plus the President and VP) stands on Medicare for All,
what they've said on the record, and who funds them. One Cloudflare Worker + D1 database.

- **Dashboard** (`/`): vote charts, searchable roster, profile drawer with stance, appearances, socials, money.
- **Map**: every state's senators and House seats, colored by party, Medicare for All stance or lean; tap a state for its members.
- **Issues** (`/#/issues`): the ~30 issues Americans rank highest, with linked polling; each profile has a position matrix on them.
- **2026 results** (`/#/elections`): every House and Senate race, plus exit-poll findings for Senate races.
- **Find your rep** (`/#/zip/<ZIP>`): senators and House member(s) for a ZIP, with stance, call button and a call script. The lookup (`public/zip/*.json`) is built by `scripts/zip_lookup.py` (run with `.venv/bin/python`, needs shapely and pyshp) from Census ZIP areas and TIGER 2026 "cd120" district shapes, so it uses the January 2027 district lines.
- **Key votes** (`/#/votes`): seven 2025 health roll calls (`scripts/key_votes.json`), each member's vote, and a "protected coverage on X of Y" score.
- **Full voting records** on every profile: every 119th-Congress roll call (`public/votes/*.json`, built by `scripts/vote_records.py` from Voteview).
- **Money–vote alignment** on profiles: health-industry money (chamber percentile) against votes on the key health votes. A correlation, not a measure of motive.
- **Follow the money** (`/#/money`): flow chart, PAC & super PAC matrix, megadonors ($1M+ people, $250k+ organizations), committee and donor pages, and a money web on each profile (`public/money/*.json`, built by `scripts/money_network.py` from FEC bulk files; run it after `build_seed.py`).
- **Congress selector**: the 120th (from Jan 3, 2027, the default) or the current 119th.
- **Admin** (`/#/admin`): password sign-in. Log appearances, add outlets, set stances, add policies, add people, document donors.

## Run locally

```bash
npm install
npx cf dev
```

The local admin password is in `.dev.vars` (not committed). The database creates and seeds itself on first request.

## Deploy

```bash
npx cf auth login
```

Put the production password in a file named `.secrets.env` (ignored by git) as `ADMIN_PASSWORD=...`, then:

```bash
npx cf deploy --secrets-file .secrets.env
```

`cf deploy` creates the D1 database on first deploy. The site seeds itself from `seed/seed.json` the first time it's opened.

## Refresh the baseline data

Raw downloads live in `data/raw/` (not committed). `scripts/fetch_roster_120.py` downloads the incoming roster
(add `--refresh` to re-pull Wikipedia), then `scripts/build_seed.py` turns everything into `seed/seed.json`.

When a deploy ships a new seed, the site refreshes the roster and FEC figures on its next request. Hand-entered work
is kept: stances you edited, appearances, donors, outlets, policies and people you added. Members who drop off the
roster are marked "former" and hidden, not deleted.

| Data | Source |
|---|---|
| January 2027 roster | Wikipedia "120th United States Congress" member list (revision pinned in the seed) |
| IDs, photos, socials for newcomers | Wikidata, matched by Wikipedia article |
| Returning members' websites and official socials | `unitedstates.github.io/congress-legislators` |
| Newcomers' Medicare for All stance | Researched Nov 2026 from campaign statements; each has a source link (`data/raw/research/`) |
| Extra X handles, Bluesky | Wikidata (properties P2002, P12361, matched on Bioguide ID) |
| Returning members' support | congress.gov API: sponsors + cosponsors of H.R.3069 and S.1506 (119th) |
| Lean (starting point) | Voteview DW-NOMINATE scores, 119th Congress; newcomers start as unknown; hand edits are kept |
| 2026 results, Cook PVI | Wikipedia "2026 United States House/Senate elections" (`scripts/results2026.py`) |
| Exit polls, issue polling | Researched Nov 2026 with source links (`data/raw/research/exit_*.json`, `issues.json`) |
| Campaign money | FEC bulk files, 2025-26: `weball26`, `cm26`, `pas226`, `independent_expenditure_2026.csv` |

Health-industry PACs are flagged by name matching in `scripts/build_seed.py` (`SECTORS`); edit the lists there.
