#!/bin/sh
# Full data refresh. Usage: scripts/refresh_all.sh [--no-download]
#   1. downloads fresh FEC bulk files and leadership-PAC sponsors (skip with --no-download)
#   2. re-pulls the 120th Congress roster from Wikipedia (picks up newly decided seats)
#   3. rebuilds every derived file in order
#   4. runs scripts/check_refresh.py, which exits non-zero if the new data looks broken
# Does not deploy. Network hosts used: www.fec.gov (+ its S3 bucket), api.open.fec.gov, en.wikipedia.org, www.wikidata.org,
# codeload.github.com (Open States).
set -eu
cd "$(dirname "$0")/.."
git show HEAD:seed/seed.json > "${TMPDIR:-/tmp}/seed.previous.json"
if [ "${1:-}" != "--no-download" ]; then
  scripts/fetch_fec.sh
  python3 scripts/fetch_leadership_pacs.py
  # Open States people data (state legislators and governors, CC0); its .claude/ folder isn't needed.
  mkdir -p data/raw/openstates
  curl -sSfL -m 600 -o data/raw/openstates/people.tar.gz https://codeload.github.com/openstates/people/tar.gz/refs/heads/main
  rm -rf data/raw/openstates/people-main && tar -xzf data/raw/openstates/people.tar.gz -C data/raw/openstates --exclude 'people-main/.claude' --exclude 'people-main/.github'
  curl -sS -m 60 -G -H 'User-Agent: civic-data-script/0.1' --data-urlencode "page=2026_United_States_gubernatorial_elections" \
    --data-urlencode "action=parse" --data-urlencode "prop=wikitext|revid" --data-urlencode "format=json" -o data/raw/wp_gov2026.json https://en.wikipedia.org/w/api.php
fi
python3 scripts/fetch_roster_120.py --refresh
python3 scripts/leadership_pacs.py
python3 scripts/employee_donations.py
.venv/bin/python scripts/state_officials.py
python3 scripts/build_seed.py
python3 scripts/money_network.py
python3 scripts/vote_records.py
.venv/bin/python scripts/zip_lookup.py
python3 scripts/check_refresh.py "${TMPDIR:-/tmp}/seed.previous.json" seed/seed.json
