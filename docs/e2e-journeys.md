# E2E Journey Catalog

Running inventory of e2e-covered user journeys. Updated by `/e2e-author` runs.

## Smoke (cross-browser, blocks merge)

| Journey | Spec | Last updated |
|---------|------|-------------|
| Homepage + landing | `e2e/smoke/visitor.spec.ts` | pre-existing |
| Landing hero + search | `e2e/smoke/landing.spec.ts` | pre-existing |
| Directory sort | `e2e/smoke/directory-sort.spec.ts` | pre-existing |
| Submit form load | `e2e/smoke/submit.spec.ts` | pre-existing |
| Navbar auth state | `e2e/smoke/navbar-auth.spec.ts` | pre-existing |
| Getting started | `e2e/smoke/getting-started.spec.ts` | pre-existing |
| Claim flow | `e2e/smoke/claim.spec.ts` | pre-existing |
| **Guide hub browsing + navigation** | `e2e/smoke/guides.spec.ts` | 2026-07-03 |

## Deep (chromium-only, nightly)

| Journey | Spec | Last updated |
|---------|------|-------------|
| **Guide detail rendering + SEO** | `e2e/tests/guide-detail.spec.ts` | 2026-07-03 |
| **Submit funnel end-to-end** | `e2e/tests/submit-funnel.spec.ts` | 2026-07-05 |
| **Dashboard analytics** | `e2e/tests/dashboard-analytics.spec.ts` | 2026-07-05 |
| **User settings** | `e2e/tests/settings.spec.ts` | 2026-07-05 |
| **Static & compliance pages** | `e2e/tests/static-pages.spec.ts` | 2026-07-05 |
| **API contracts** | `e2e/tests/api-contracts.spec.ts` | 2026-07-05 |
| **Single-brand dashboard navigation** | `e2e/tests/dashboard-tabs.spec.ts` | 2026-07-05 |
| **Five-step brand editor navigation** | `e2e/tests/dashboard-brand-edit-wizard.spec.ts` | 2026-07-07 |
| **Dashboard hero and product image persistence** | `e2e/tests/dashboard-image-upload.spec.ts` | 2026-07-07 |
| **Submission hero image persistence** | `e2e/tests/submit-funnel.spec.ts` | 2026-07-07 |
| **Persisted locale switching** | `e2e/tests/i18n-en.spec.ts` | 2026-07-07 |
| **Password reset request + reset-page guard** | `e2e/tests/auth-password-reset.spec.ts` | 2026-07-11 |
| **Brand without links — no dangling section headings** | `e2e/tests/brand-detail.spec.ts` | 2026-07-11 |
| **Admin enrichment job history, detail, and manual rerun** | `e2e/tests/admin-jobs.spec.ts` | 2026-07-13 |
| _(30+ existing deep specs omitted — see e2e/tests/ for full inventory)_ | | |

## Carried backlog (from 2026-07-11 run)

- Error-boundary rendering journey (force a route error, assert localized RouteError copy) — P3; negative assertions exist in brand-detail/guide-detail/cjk-slug/stats/admin specs.
- Loading-skeleton visibility — P3; transient UI, flaky to assert.
- Turnstile error/expiration handling in submit form — P3; no Turnstile TEST keys in e2e env.
