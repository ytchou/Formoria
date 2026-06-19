#!/bin/bash
# Full pipeline: merge → resolve profiles → enrich → finalize
# Run from project root: bash scripts/threads-scraper/run-pipeline.sh

set -e
cd "$(dirname "$0")/../.."

echo "=== Step 1: Merge vk123 + Threads brands ==="
python3 scripts/threads-scraper/resolve-and-merge.py

echo ""
echo "=== Step 2: Enrich (scrape brand websites) ==="
pnpm tsx scripts/threads-scraper/enrich.ts scripts/threads-scraper/output/all-brands-merged.json

echo ""
echo "=== Step 3: Finalize CSV ==="
pnpm tsx scripts/threads-scraper/finalize.ts scripts/threads-scraper/output/all-brands-merged.enriched.csv

echo ""
echo "=== Done ==="
echo "Final CSV: scripts/threads-scraper/output/all-brands-merged.final.csv"
echo "Upload to /admin/import"
