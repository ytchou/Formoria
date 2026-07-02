#!/usr/bin/env bash
#
# subset-fonts.sh — ONE-TIME font vendoring step (DEV-712)
#
# The OpenGraph image routes (next/og + satori) run on the Node.js runtime and
# load fonts from disk via `fs`. To render Traditional-Chinese text
# (台灣製造品牌目錄 and dynamic category names) without tofu while keeping the
# vendored TTFs small, we pre-subset two open-source (OFL) fonts and commit the
# results into src/assets/fonts/.
#
# This script records the EXACT commands used so the subset is reproducible.
# It is NOT part of the build — run it by hand only when the coverage or source
# fonts need to change, then commit the regenerated files.
#
# Requirements:
#   - fonttools (provides `pyftsubset` + `fonttools varLib.instancer`)
#       uv tool install fonttools   # preferred
#       # or: pipx install fonttools / pip install fonttools
#   - curl
#
# Outputs (committed):
#   src/assets/fonts/NotoSansTC-subset.ttf      (< 800 KB)
#   src/assets/fonts/BricolageGrotesque-Latin.ttf
#
# Run from the repo root:  bash scripts/fonts/subset-fonts.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$REPO_ROOT/src/assets/fonts"
TMP="$(mktemp -d -t dev712-fonts.XXXXXX)"
mkdir -p "$OUT_DIR"

# Fixed brand strings that must ALWAYS be present, regardless of frequency list.
BRAND_TEXT="Formoria台灣製造品牌目錄我們上架了"

echo "==> temp dir: $TMP"
echo "==> output:   $OUT_DIR"

# ---------------------------------------------------------------------------
# 1. Source fonts (open-source / OFL)
# ---------------------------------------------------------------------------

# Noto Sans TC — Bold (weight 700), CFF subset OTF from the official notofonts repo.
curl -sL -o "$TMP/NotoSansTC-Bold.otf" \
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/TC/NotoSansTC-Bold.otf"

# Bricolage Grotesque — variable font (opsz,wdth,wght) from its GitHub repo.
curl -sL -o "$TMP/BricolageGrotesque-VF.ttf" \
  "https://github.com/ateliertriay/bricolage/raw/main/fonts/variable/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf"

# ---------------------------------------------------------------------------
# 2. Build the Traditional-Chinese coverage set
# ---------------------------------------------------------------------------
#
# The full CJK ideograph block (U+4E00-9FFF, ~20k glyphs) blows past the 800 KB
# budget. Instead we cover the most common Traditional-Chinese characters using a
# FREQUENCY-RANKED list and take the top 3000. Source font is CFF-flavored
# (dense), so 3000 ideographs + Latin + punctuation lands around ~732 KB.
#
# Frequency list: agj/3000-traditional-hanzi -> data/external/frequency.txt
# (tab-separated: char <TAB> count <TAB> strokes, ordered most-common first).
# Top 3000 covers the overwhelming majority of real-world Traditional Chinese
# text, so dynamic category names render in practice. The fixed brand strings
# are appended unconditionally so 台灣製造品牌目錄 is never dropped.
curl -sL -o "$TMP/frequency.txt" \
  "https://raw.githubusercontent.com/agj/3000-traditional-hanzi/master/data/external/frequency.txt"

TOP_N=3000
BRAND_TEXT="$BRAND_TEXT" TOP_N="$TOP_N" python3 - "$TMP/frequency.txt" "$TMP/tc-top.txt" <<'PY'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
top_n = int(os.environ["TOP_N"])
brand = os.environ["BRAND_TEXT"]
chars = []
with open(src, encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        c = line.split("\t")[0]
        if c and ord(c[0]) >= 0x3400:  # CJK ideograph (skip header/punct rows)
            chars.append(c[0])
        if len(chars) >= top_n:
            break
seen = list(dict.fromkeys(chars))
for c in brand:                        # guarantee brand ideographs present
    if ord(c) >= 0x3400 and c not in seen:
        seen.append(c)
with open(dst, "w", encoding="utf-8") as fh:
    fh.write("".join(seen))
print(f"   tc-top.txt: {len(seen)} ideographs")
PY

# ---------------------------------------------------------------------------
# 3. Subset Noto Sans TC
# ---------------------------------------------------------------------------
# Unicode ranges kept (alongside the frequency text file):
#   U+0020-007E  Basic Latin (printable)
#   U+2000-206F  General Punctuation
#   U+3000-303F  CJK Symbols and Punctuation
#   U+FF00-FFEF  Halfwidth and Fullwidth Forms
# --text / --text-file add the common ideographs + brand strings on top.
pyftsubset "$TMP/NotoSansTC-Bold.otf" \
  --output-file="$OUT_DIR/NotoSansTC-subset.ttf" \
  --no-hinting \
  --unicodes="U+0020-007E,U+2000-206F,U+3000-303F,U+FF00-FFEF" \
  --text-file="$TMP/tc-top.txt" \
  --text="$BRAND_TEXT"

# ---------------------------------------------------------------------------
# 4. Subset Bricolage Grotesque (Latin only)
# ---------------------------------------------------------------------------
# Instance the variable font to Bold (wght=700) first, then keep Latin +
# General Punctuation only.
fonttools varLib.instancer "$TMP/BricolageGrotesque-VF.ttf" \
  wght=700 -o "$TMP/BricolageGrotesque-Bold.ttf"

pyftsubset "$TMP/BricolageGrotesque-Bold.ttf" \
  --output-file="$OUT_DIR/BricolageGrotesque-Latin.ttf" \
  --no-hinting \
  --unicodes="U+0020-007E,U+2000-206F"

# ---------------------------------------------------------------------------
# 5. Report
# ---------------------------------------------------------------------------
echo "==> done:"
ls -la "$OUT_DIR"
echo "    Noto subset must be < 800 KB."

rm -rf "$TMP"
