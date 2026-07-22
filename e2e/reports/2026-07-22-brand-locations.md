# E2E Author Report — Brand Locations — 2026-07-22

## Authored and refreshed coverage

- `e2e/tests/dashboard-brand-owned-edit.spec.ts`: actual-owner confirmation and persistence of an addressed physical location through the dashboard editor.
- `e2e/tests/brand-detail.spec.ts`: self-seeded mixed public locations covering confirmed physical locations, unconfirmed leads, and retail-chain channels.
- `e2e/tests/brand-detail.spec.ts`: Littdlework name-only location records remain visible without rendering a map.

## E2E verification

- **PASS — mixed public locations:** Ran against the isolated linked worktree with `BASE_URL=http://localhost:3100`; 1 test passed in 1.7 minutes. Verified all three counted groups, suppression of the unconfirmed record's stored address, the retailer link, map/filter/list behavior, and mobile keyboard and 48 px target behavior.
- **PASS — Littdlework no-map:** Ran against port 3100; 1 test passed in 1.3 minutes. Verified `永康旗艦店` is visible and no map renders.
- **UNVERIFIED / BLOCKED — owner confirmation:** Two capped attempts mistakenly reused `http://localhost:3000`, whose listener's working directory was the dirty primary checkout. That stale app did not contain the current add-location button. This is an environment-targeting failure, not evidence of an application bug. Rerun this journey later against an isolated linked-worktree server on its own port.

## Project verification

- Unit tests: 90 final tests passed.
- Lint: passed with zero errors.
- TypeScript (`tsc`): passed.
- Next.js production build: passed, 811/811.

## Linked database checks

- Migration list check passed; migration `20260722100004` remains pending locally.
- Database advisors completed with warnings only.
- Remote database lint still reports the pre-existing `check_brand_duplicates` reference to removed column `unified_business_number`; this is unrelated to the brand-location changes.

## Deferred catalog update

The matching `docs/e2e-journeys.md` catalog update is deferred because the dirty primary checkout must remain untouched.
