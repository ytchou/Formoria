#!/bin/bash
set -euo pipefail
echo "Bulk importing brands from taiwan-brands dataset..."
npx tsx scripts/seed-brands.ts
echo "Done."
