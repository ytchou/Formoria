# E2E Plan: SEO Index Coverage

## Scope

Validate the public behaviors changed by the brand and guide indexing work. The tests should exercise browser-visible metadata and route visibility without duplicating unit coverage for internal helpers.

## Journeys

1. **Localized brand indexing (P1)**
   - Discover an eligible brand from the generated sitemap.
   - Confirm both zh-TW and English URLs are listed.
   - Confirm both pages are indexable, self-canonical, and expose reciprocal hreflang links plus x-default.
2. **Non-public brand exclusion (P1)**
   - Seed a hidden brand.
   - Confirm its public detail URL does not expose brand content and emits `noindex` in the development-server journey.
   - Confirm the production server returns HTTP 404 during release verification.
3. **Guide locale eligibility (P2)**
   - Confirm the authored zh-TW guide is indexable and only advertises its authored locale.
   - Confirm the English route remains readable but emits `noindex` and does not advertise an unavailable English alternate.

## Existing Coverage Retained

- Authenticated navbar state and owner links: `e2e/smoke/navbar-auth.spec.ts`
- Claim eligibility and pending-claim state: `e2e/smoke/claim.spec.ts`
- Brand detail rendering and structured data: `e2e/tests/brand-detail.spec.ts`
- Guide content and structured data: `e2e/tests/guide-detail.spec.ts`

## Verification

- Run the three affected deep specs together in Chromium.
- Run TypeScript and ESLint after the spec changes.
- Record results and remaining coverage gaps in `docs/e2e/reports/2026-07-15-seo-index-coverage.md`.
