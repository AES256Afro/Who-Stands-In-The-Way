#!/bin/sh
# Downloads the FEC 2025-26 bulk files used by the build into data/raw/ (about 3 GB; indiv26.zip is 2.7 GB).
# Small files are unzipped; oth26.zip and indiv26.zip stay zipped (the scripts stream them).
set -eu
cd "$(dirname "$0")/../data/raw"
B=https://www.fec.gov/files/bulk-downloads/2026
for f in weball26.zip cm26.zip pas226.zip ccl26.zip webk26.zip oth26.zip indiv26.zip independent_expenditure_2026.csv; do
  echo "downloading $f"
  curl -sSfL -m 3600 -o "$f.part" "$B/$f" && mv "$f.part" "$f"
done
for z in weball26 cm26 pas226 ccl26 webk26; do unzip -o -q "$z.zip" && rm "$z.zip"; done
ls -la weball26.txt cm.txt itpas2.txt ccl.txt webk26.txt oth26.zip indiv26.zip independent_expenditure_2026.csv
