# E2E Journey Catalog

Running inventory of e2e-covered user journeys. Updated by `/e2e-author` runs.

## Selective PR smoke (Chromium)

Smoke is a tagged subset of the canonical deep suite. The PR selector resolves affected route families and runs only matching `@smoke` cases in Chromium. The scheduled deep workflow still runs every canonical case.

| Journey | Canonical spec | Last updated |
|---------|----------------|-------------|
| Landing entry point and directory sort URL state | `e2e/tests/directory-sort.spec.ts` | 2026-08-04 |
| Claim approval lifecycle and post-claim ownership | `e2e/tests/claim-smoke.spec.ts` | 2026-08-04 |
| Sign-in Google entry point | `e2e/tests/auth-signin.spec.ts` | 2026-08-04 |
| Brand detail rendering | `e2e/tests/brand-detail.spec.ts` | 2026-08-04 |
| Events hub state and navigation | `e2e/tests/events.spec.ts`, `e2e/tests/events-navigation.spec.ts` | 2026-08-04 |
| FAQ sections and details | `e2e/tests/faq.spec.ts` | 2026-08-04 |
| Getting-started hero | `e2e/tests/getting-started.spec.ts` | 2026-08-04 |
| Submission entry points and authenticated redirect | `e2e/tests/community-submit.spec.ts` | 2026-08-04 |
| Stories hub state and navigation | `e2e/tests/stories.spec.ts`, `e2e/tests/stories-navigation.spec.ts` | 2026-08-04 |
| Navbar authenticated state | `e2e/tests/navbar-auth.spec.ts` | 2026-08-04 |
| Public routing, filters, search, and metadata regressions | `e2e/tests/public-routing-regressions.spec.ts` | 2026-08-04 |
| Persisted locale switching | `e2e/tests/i18n-en.spec.ts` | 2026-08-04 |

## Conditional cross-browser compatibility

Browser-sensitive shared changes run exactly one public, read-only journey in Chromium, Firefox, and WebKit: landing search navigates to the matching directory, then directory sorting preserves coherent URL and rendered state.

| Journey | Spec | Last updated |
|---------|------|-------------|
| Landing search to sortable matching directory | `e2e/tests/landing-search-cross-browser.spec.ts` | 2026-08-04 |

## User-facing route smoke audit

Audit baseline: **68 route families; 14 mapped; 54 visible migration warnings.** API handlers, metadata endpoints, internal-only endpoints, and authentication callbacks are excluded. A route may be covered by a shared journey; the table records the canonical case that exercises it.

### Mapped routes

| Route family | Core journey | Canonical spec |
|--------------|--------------|----------------|
| `/` | Landing entry point | `e2e/tests/directory-sort.spec.ts` |
| `/admin/claims` | Claim approval lifecycle | `e2e/tests/claim-smoke.spec.ts` |
| `/auth/sign-in` | Google entry point | `e2e/tests/auth-signin.spec.ts` |
| `/brands` | A-Z sort URL state | `e2e/tests/directory-sort.spec.ts` |
| `/brands/[slug]` | Brand detail render | `e2e/tests/brand-detail.spec.ts` |
| `/dashboard` | Post-claim dashboard ownership | `e2e/tests/claim-smoke.spec.ts` |
| `/events` | Hub empty/published state | `e2e/tests/events.spec.ts` |
| `/faq` | FAQ sections/details | `e2e/tests/faq.spec.ts` |
| `/getting-started` | Hero render | `e2e/tests/getting-started.spec.ts` |
| `/my-submissions` | Authenticated redirect | `e2e/tests/community-submit.spec.ts` |
| `/stories` | Hub empty/published state | `e2e/tests/stories.spec.ts` |
| `/submit/owner` | Owner quick journey | `e2e/tests/community-submit.spec.ts` |
| `/submit/owner/quick` | Owner quick fields | `e2e/tests/community-submit.spec.ts` |
| `/submit/recommend` | Recommendation form | `e2e/tests/community-submit.spec.ts` |

### Uncovered route warnings

- Admin: `/admin`, `/admin/brands`, `/admin/catalog`, `/admin/catalog/brands`, `/admin/claim-requests`, `/admin/corrections`, `/admin/evidence`, `/admin/feature-requests`, `/admin/jobs`, `/admin/jobs/[id]`, `/admin/moderation`, `/admin/newsletter`, `/admin/quality`, `/admin/reports`, `/admin/review-queue`, `/admin/review-queue/moderation`, `/admin/review-queue/submissions`, `/admin/scripts`, `/admin/scripts/bulk-community-submissions`, `/admin/settings`, `/admin/signals`, `/admin/signals/reports`, `/admin/submissions`.
- Authentication/public: `/about`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/sign-up`, `/challenge`, `/contact`, `/contributions`, `/feature-requests`, `/glossary`, `/privacy`, `/stats`, `/terms`, `/vision`.
- Dashboard: `/dashboard/analytics`, `/dashboard/brands/[slug]`, `/dashboard/brands/[slug]/analytics`, `/dashboard/brands/[slug]/edit`, `/dashboard/brands/[slug]/info`, `/dashboard/brands/[slug]/links`, `/dashboard/brands/[slug]/media`, `/dashboard/brands/[slug]/reputation`, `/dashboard/brands/[slug]/verification`.
- Other: `/events/[slug]`, `/favorites`, `/settings`, `/site/[slug]`, `/stories/[slug]`, `/submit`, `/submit/confirmation`, `/submit/form`, `/submit/owner/details`.

These are warnings during migration, not evidence that the routes have no deep coverage. Enable the no-new-gap regression gate only after the smoke baseline reaches zero uncovered route families.

## Deep (chromium-only, nightly)

| Journey | Spec | Last updated |
|---------|------|-------------|
| **Guide detail rendering + SEO** | `e2e/tests/guide-detail.spec.ts` | 2026-07-03 |
| **Domain-email claim — approval blocked until real-route verification, then ownership granted** | `e2e/tests/claim-lifecycle.spec.ts` | 2026-07-23 |
| **Private business-document claim — anonymous access denied, admin rejection, deletion, no ownership** | `e2e/tests/claim-lifecycle.spec.ts` | 2026-07-23 |
| **Submit funnel end-to-end** | `e2e/tests/submit-funnel.spec.ts` | 2026-07-05 |
| **Submit recommendation — duplicate recovery and rapid repeat-submit persistence** | `e2e/tests/submit-recommend-edge-cases.spec.ts` | 2026-07-19 |
| **Detailed owner wizard — final-only persistence, shared links, romanized URL preview** | `e2e/tests/submit-funnel.spec.ts` | 2026-07-16 |
| **Owner-authorized PostHog session analytics and provider state** | `e2e/tests/dashboard-analytics.spec.ts` | 2026-07-20 |
| **User settings** | `e2e/tests/settings.spec.ts` | 2026-07-05 |
| **Static & compliance pages** | `e2e/tests/static-pages.spec.ts` | 2026-07-05 |
| **API contracts** | `e2e/tests/api-contracts.spec.ts` | 2026-07-05 |
| **Single-brand dashboard navigation** | `e2e/tests/dashboard-tabs.spec.ts` | 2026-07-05 |
| **Five-step brand editor navigation** | `e2e/tests/dashboard-brand-edit-wizard.spec.ts` | 2026-07-07 |
| **Shared dashboard wizard — persisted drafts, link rows, romanized URL preview** | `e2e/tests/dashboard-brand-owned-edit.spec.ts` | 2026-07-16 |
| **Dashboard hero and product image persistence** | `e2e/tests/dashboard-image-upload.spec.ts` | 2026-07-07 |
| **Submission hero image persistence** | `e2e/tests/submit-funnel.spec.ts` | 2026-07-07 |
| **Persisted locale switching** | `e2e/tests/i18n-en.spec.ts` | 2026-07-07 |
| **Password reset request + reset-page guard** | `e2e/tests/auth-password-reset.spec.ts` | 2026-07-11 |
| **Brand without links — no dangling section headings** | `e2e/tests/brand-detail.spec.ts` | 2026-07-11 |
| **Admin operations ledger, quick actions, and responsive layout** | `e2e/tests/admin-dashboard.spec.ts` | 2026-07-18 |
| **Admin unified job log, cancellation, detail, and manual rerun** | `e2e/tests/admin-jobs.spec.ts` | 2026-07-18 |
| **Admin newsletter filtering, safe fields, and export scope** | `e2e/tests/admin-newsletter.spec.ts` | 2026-07-18 |
| **Admin run-log HTML access and anonymous auth gate** | `e2e/tests/admin-runlog.spec.ts` | 2026-07-15 |
| **Admin submission enrichment lifecycle and approval** | `e2e/tests/admin-submission-enrichment.spec.ts` | 2026-07-15 |
| **Submission publishable-core link guard — myship-only approves, no-links rejects** | `e2e/tests/admin-submission-publishable-core.spec.ts` | 2026-08-05 |
| **Scheduled approved-brand refresh request, review, and in-place apply** | `e2e/tests/admin-brand-refresh.spec.ts` | 2026-07-20 |
| **Localized brand indexability and hidden-brand exclusion** | `e2e/tests/seo.spec.ts`, `e2e/tests/brand-detail.spec.ts` | 2026-07-15 |
| **Guide locale indexability** | `e2e/tests/guide-detail.spec.ts` | 2026-07-15 |
| **Directory filters, zero-result recovery, and contextual recommendations** | `e2e/tests/directory.spec.ts` | 2026-07-16 |
| **Public search — API boundaries, ranking, bilingual/fuzzy matching, entry points, async state, filters, and recovery** | `e2e/tests/search-edge-cases.spec.ts` | 2026-07-19 |
| **FAQ sections (General + For Owners), #for-owners anchor, #claim auto-open** | `e2e/tests/faq.spec.ts` | 2026-07-23 |
| **Public brand support toggle and admin heading-menu placement** | `e2e/tests/brand-actions.spec.ts` | 2026-07-31 |
| **Owner welcome card — visible on fresh brand, dismissal persists** (RED: duplicate content tree after dismiss+reload — see e2e/reports/2026-07-23.md) | `e2e/tests/dashboard-welcome-card.spec.ts` | 2026-07-23 |
| **Public feature request board — anonymous read, sign-in handoff on upvote, submit, vote toggle, category filter, admin duplicate merge** | `e2e/tests/feature-requests.spec.ts` | 2026-07-28 |
| **Signup form + registration (fails loudly on outage)** | `e2e/tests/auth-signup.spec.ts` | 2026-07-30 |
| **Signup → email confirmation → onboarding → first value** | `e2e/tests/auth-signup-journey.spec.ts` | 2026-07-30 |
| **Event detail — Event JSON-LD with unshifted Taipei dates, client-side area filtering, bilingual canonical/hreflang** (skips until an event is seeded — runtime gate in `e2e/utils/seeded-events.ts`) | `e2e/tests/event-detail.spec.ts` | 2026-07-31 |
| _(30+ existing deep specs omitted — see e2e/tests/ for full inventory)_ | | |

## Mobile (Pixel 5, nightly)

| Journey | Spec | Last updated |
|---------|------|-------------|
| **Responsive overflow on landing, directory, submission, and sign-in pages** | `e2e/tests/mobile.spec.ts` | 2026-07-27 |
| **Mobile brand-card rendering and navigation access** | `e2e/tests/mobile.spec.ts` | 2026-07-27 |

## Carried backlog (from 2026-07-11 run)

- Error-boundary rendering journey (force a route error, assert localized RouteError copy) — P3; negative assertions exist in brand-detail/guide-detail/cjk-slug/stats/admin specs.
- Loading-skeleton visibility — P3; transient UI, flaky to assert.
- Turnstile error/expiration handling in submit form — P3; no Turnstile TEST keys in e2e env.
- English-locale support action copy — P3; action coverage currently asserts the default zh-TW locale.
- Origin-evidence submission journey — dropped 2026-07-31 with the trigger; the surface is unwired pending guest submission (board: `origin_evidence_reports`). Re-author when it returns.
- Cross-browser smoke coverage for public brand support — P3; the current journey is deep and database-backed.
