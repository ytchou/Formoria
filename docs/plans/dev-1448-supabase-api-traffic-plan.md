# DEV-1448 — Supabase API traffic attribution and brand ISR

## Goal

Stop build-time prerendering of every brand detail route, remove the redundant
related-brand count query, attribute server-side Supabase requests without PII,
and add a build guard/runbook so future regressions are visible in traffic
logs.

## Implementation

1. Keep the localized brand detail route's `generateStaticParams` export but
   return an empty array so paths omitted from the build remain on-demand ISR
   with `revalidate = 3600`. Add an exact
   prefixless `/brands/[slug]` route in a `(default-site)` group that adapts
   the same page and fixed `zh-TW` layouts. After locale inference has had a
   chance to redirect English users, proxy prefixless brand details with
   `NextResponse.next` and a URL-shape-derived `zh-TW` request locale; direct
   `/zh-TW/...` requests continue through next-intl canonicalization. Preserve
   metadata, JSON-LD, and sitemap behavior. Remove the now-unused
   `getAllBrandSlugs` service function and all callers.
2. In the centralized public-brand invalidation helper, invalidate the actual
   detail cache keys emitted by the route split: `/brands/<slug>` for the
   prefixless default locale, `/en/brands/<slug>` for English, and the
   microsite path. Do not invalidate the obsolete `/zh-TW/brands/<slug>` key.
   Add `excludeSlug` to internal `getBrands` filters and apply it in the
   browse query. Make `getRelatedBrands` return `{ brands, totalCount }`, with
   the current slug excluded in the query, and use that count for the related
   brand display/analytics total. Remove `getBrandCountByCategory` and its
   callers.
3. Add an exported pure Supabase User-Agent attribution helper. Build a
   non-PII value distinguishing build, runtime, development, test, and script
   traffic, optionally appending a short `RAILWAY_GIT_COMMIT_SHA`; pass it via
   `global.headers` while retaining supabase-js's default `x-client-info`.
4. Add a prerender-manifest guard with a zero budget for concrete brand detail
   routes and wire it into `pnpm build`. Capture the expected red result from
   the current `.next` manifest before the route change; leave the final full
   build to the verifier.
5. Add high-value tests only: attribution helper, manifest guard, and a real DB
   related-brand integration test when the existing safe test-project pattern
   is available. Do not mock Supabase.
6. Add the Supabase API traffic investigation runbook, including ClickHouse
   grouping queries, deployment windows, separate Formoria-owned/external
   reporting, and the historical-evidence limitation.
7. Update only stale e2e comments for full brand detail generation; do not
   author or execute e2e specs.

## Verification

- Run the guard against the current `.next` manifest and record its expected
  failure (the current corpus contains 1,590 concrete brand routes).
- Run the new pure/helper and guard tests red before their implementations,
  then green after implementation.
- Run the scoped service integration test with the existing DB environment if
  it is safely configured; otherwise document that it remains skipped by the
  project's `describeWithDb` guard.
- The parent verifier runs final lint, typecheck, scoped tests, full build, and
  production ISR smoke testing.

## Risks and constraints

- Empty `generateStaticParams` plus `revalidate = 3600` keeps both exact brand
  routes on-demand ISR without forcing localized requests into the default
  locale. The prefixless route is selected structurally, so no client-
  controlled header is trusted to bypass next-intl.
- The User-Agent must never contain payloads, credentials, IPs, or other PII.
- Existing user changes and unrelated test behavior remain untouched.
