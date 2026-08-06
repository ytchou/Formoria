---
type: debug-handoff
created: 2026-08-07
slug: expo-category-url
sentry_issue_ids: []
railway_service: null
---

# Debug Handoff: Creative Expo category URL hydration

## Root Cause

`ExplorerUrlSeed` in `src/components/events/taiwan-creative-expo-explorer.tsx` passes the canonical URL value `crafts` to `parseCreativeExpoUrlState`, but its category allowlist comes from `deriveCategoryOptions` and contains the linked brands' stored category values. The Creative Expo data uses the legacy display value `工藝文創`, so the literal allowlist check rejects `crafts`; interactive selection likewise passes the stored value to URL synchronization and leaks `工藝文創` into the query string.

## Evidence

### From code investigation

- The E2E report for commit `6ff6304d` records that direct navigation with `?zone=K2&category=crafts` selects K2, leaves All categories pressed, and shows all 33 K2 brands.
- `ExplorerUrlSeed` supplies `categoryOptions.map(option => option.value)` to `parseCreativeExpoUrlState`, whose current category branch only accepts exact string membership.
- `deriveCategoryOptions` uses `entry.brand.category` as each option value, while `getBrandCategoryLabel` explicitly supports category values stored as slugs, English names, or Chinese names.
- The taxonomy maps canonical slug `crafts` to display values `Crafts & Art` and `工藝文創`; no existing reverse slug helper is available.
- The existing pure URL test only uses slug-valued options, so it cannot detect the production data-shape mismatch.

### From Sentry

- Sentry is available for org/project `formoria`, but no issue matches this deterministic state-initialization defect; `sentry_issue_ids` remains empty.

## Fix

### Files to change

- `src/lib/brands/category-label.ts` — expose a small taxonomy-backed resolver from slug or localized display value to canonical slug, reusing the lookup already used for labels.
- `src/lib/events/creative-expo-explorer.ts` — resolve an allowlisted canonical URL category to the event's stored option value during parsing, and serialize stored category values back to canonical slugs.
- `src/lib/events/creative-expo-explorer.test.ts` — add a pure regression case proving `category=crafts` hydrates when the actual option value is `工藝文創`, and that URL generation remains canonical.
- `docs/lessons/dev-1372-expo-category-url.md` — document Symptom, Cause, Prevention, and How to apply.

### Step-by-step

1. Add the regression assertion first and run only `src/lib/events/creative-expo-explorer.test.ts`; capture its failure before production edits.
2. Reuse the product-type ontology to map slug/name/nameZh variants to the canonical slug.
3. In Creative Expo URL parsing, select the actual allowlisted option whose canonical slug matches the requested canonical slug; keep unknown values rejected.
4. In URL building/synchronization, serialize a recognized stored value as its canonical slug so interactive clicks and direct links share one contract.
5. Keep explorer state/filter comparisons on the stored option value, avoiding changes to generic event filtering or persisted data.

## Verification

- [ ] RED: `pnpm vitest run src/lib/events/creative-expo-explorer.test.ts` fails on the new legacy-value hydration assertion before the fix.
- [ ] GREEN: the same focused pure test passes after the fix.
- [ ] Run the relevant category-label pure test if that shared helper changes.
- [ ] Run: `pnpm exec tsc --noEmit`
- [ ] Run focused ESLint and Prettier checks for changed source/test files.
- [ ] Run the single affected Playwright desktop smoke journey from `e2e/tests/event-detail.spec.ts` against an owned worktree server; install a trap before start, track the exact PID, and verify cleanup.
- [ ] Confirm the corrected optional Back-query expectation completes in the same scoped E2E run.
- [ ] Confirm direct `/zh-TW/events/2026-taiwan-creative-expo?zone=K2&category=crafts` selects both K2 and Crafts & Art and reports the composed result count.

## Rollback

Revert the resulting fix commit; the change is isolated to pure taxonomy/Creative Expo URL normalization, its test, and documentation.

## Risk and pre-mortem

The fix fails entirely if category options contain an unrecognized value outside the product-type ontology; preserve exact-value behavior for such options while canonicalizing recognized taxonomy values. A silent regression would be filtering by the canonical slug while entries still hold display values, so the state must retain the actual option value and only the URL boundary may use the slug.
