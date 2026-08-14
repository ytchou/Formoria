/**
 * Guards the public test-brand exclusion.
 *
 * `excludeTestBrands()` is opt-in per call site, and that is exactly how it
 * drifted twice: first /about and /stats reporting one more brand than /brands,
 * then discovery reads (homepage rail, empty-state recommendations, and
 * category counts) shipping unfiltered — which is how an [E2E-TEST] brand
 * reached the live homepage.
 *
 * A unit test cannot cover this: these functions build their own service client,
 * and check-test-boundaries.mjs forbids mocking it. The property is static
 * anyway, so assert it statically — every reader of approved brands either
 * applies the filter or is listed below with a reason.
 */
import { readFileSync } from "node:fs";

const SOURCE = "src/lib/services/brands.ts";

/** Readers that must stay unfiltered, each with the reason it is safe. */
const ALLOWED_UNFILTERED = new Map([
  [
    "getBrands",
    "search branch hydrates RPC ids and must keep [E2E-TEST] brands reachable by exact name (see the comment above it); the browse branch IS filtered, conditionally on filters.includeTestBrands for /admin/brands",
  ],
  [
    "queryApprovedBrandsBySlugs",
    "by-slug hydration — the caller already chose the slugs",
  ],
  [
    "getPublicBrandDetailBySlug",
    "by-slug detail read; e2e specs navigate seeded brands directly",
  ],
  [
    "getPublicMicrositeBrandBySlug",
    "by-slug microsite read; e2e specs navigate seeded brands directly",
  ],
  [
    "getApprovedBrandBySlug",
    "by-slug read; e2e specs navigate seeded brands directly",
  ],
  [
    "getPublicBrandFaqContextById",
    "by-id read; the caller already resolved the brand",
  ],
  [
    "getAdminBrandOptions",
    "admin-only brand picker for the curated-products editor; like /admin/brands it must keep [E2E-TEST] brands selectable, and it renders on no public route",
  ],
]);

const source = readFileSync(SOURCE, "utf8");

// Split on top-level function declarations. Bodies do not need to be exact —
// only attributed to the right name — so a line-anchored split is enough.
const declaration = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
const starts = [...source.matchAll(declaration)].map((match) => ({
  name: match[1],
  index: match.index,
}));

const violations = [];
for (const [position, { name, index }] of starts.entries()) {
  const body = source.slice(index, starts[position + 1]?.index ?? source.length);
  const readsApprovedBrands =
    body.includes('.from("brands")') &&
    body.includes('.eq("status", "approved")');
  if (!readsApprovedBrands) continue;
  if (body.includes("excludeTestBrands(")) continue;
  if (ALLOWED_UNFILTERED.has(name)) continue;

  const line = source.slice(0, index).split("\n").length;
  violations.push(`${SOURCE}:${line} ${name}()`);
}

if (violations.length > 0) {
  console.error(
    "Public reads of approved brands must apply excludeTestBrands(), or be added\n" +
      "to ALLOWED_UNFILTERED in scripts/check-test-brand-filter.mjs with a reason:",
  );
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Test-brand exclusion guard passed.");
}
