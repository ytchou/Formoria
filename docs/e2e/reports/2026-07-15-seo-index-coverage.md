# E2E Report: SEO Index Coverage

## Result

The changed public journeys are covered and production verification passes.

## Browser Run

Command scope: `e2e/tests/seo.spec.ts`, `e2e/tests/brand-detail.spec.ts`, and `e2e/tests/guide-detail.spec.ts` in the `deep` Chromium project.

- First run: 29 passed, 3 failed. The failures identified a real soft-404 issue plus two assertions that treated an absent robots tag as a failure.
- Second run: 30 passed, 2 failed. Both remaining failures were environment assumptions: a development streamed-not-found response reports 200, and an absolute sitemap URL navigated to the live production origin.
- The assertions were corrected after the retry limit. No third browser retry was run.

## Production Verification

- Clean Next.js production build: 777 static pages generated.
- Exhaustive sitemap crawl: 690/690 localized brand URLs passed.
- Checks per URL: HTTP 200, no `noindex`, self-canonical, reciprocal zh-TW/en hreflang, x-default, sitemap pair, and `s-maxage=3600` without private/no-store.
- CJK slug verification: lowercase percent-encoded sitemap/canonical URLs no longer redirect.
- Hidden brand probe: HTTP 404, `noindex`, and no hidden content exposure.
- Missing guide probe: HTTP 404 and `noindex`.

## Existing Coverage Reused

- Authenticated viewer/navigation behavior remains covered by `e2e/smoke/navbar-auth.spec.ts`.
- Claim eligibility and pending-claim behavior remain covered by `e2e/smoke/claim.spec.ts`.

## Deferred

- A dedicated visual assertion for the removed route-level loading skeletons is intentionally omitted; their removal is required to prevent streamed soft 404 responses.
