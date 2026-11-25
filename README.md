# Who Stands In The Way

Tracks where every member of Congress (plus the President and VP) stands on Medicare for All,
what they've said on the record, and who funds them. One Cloudflare Worker + D1 database.

- **Dashboard** (`/`): vote charts, searchable roster, profile drawer with stance, appearances, socials, money.
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

Raw downloads live in `data/raw/` (not committed). `scripts/build_seed.py` turns them into `seed/seed.json`.
The seed only loads into an **empty** database, so re-running it never overwrites admin edits.

| Data | Source |
|---|---|
| Members, websites, official socials | `unitedstates.github.io/congress-legislators` (`legislators-current.json`, `legislators-social-media.json`) |
| Extra X handles, Bluesky | Wikidata (properties P2002, P12361, matched on Bioguide ID) |
| Medicare for All support | congress.gov API: sponsors + cosponsors of H.R.3069 and S.1506 (119th) |
| Campaign money | FEC bulk files, 2025-26: `weball26`, `cm26`, `pas226`, `independent_expenditure_2026.csv` |

Health-industry PACs are flagged by name matching in `scripts/build_seed.py` (`SECTORS`); edit the lists there.
