# Formoria E2E journey catalog

Last refreshed: 2026-08-21 — `chore/test-suite-dead-code-cleanup`. That branch deleted e2e specs whose assertions were claimed to be owned by a unit test; the claims were re-verified and the assertions whose named owner tested a builder function rather than the rendered page were restored.

The canonical browser suite targets the isolated staging Supabase project. Deep specs run in Desktop Chrome; `@smoke` identifies critical cases inside that same project. Fixtures create `[E2E-TEST]` rows and global teardown audits run-scoped cleanup.

| Journey | Primary surface | Spec | Project | Coverage |
|---|---|---|---|---|
| Scheduled brand refresh review and bulk approval | `/admin/brands/refresh` | `e2e/tests/admin-brand-refresh.spec.ts` | deep | refresh request, staging, apply, partial bulk failure |
| Admin dashboard operations | `/admin` | `e2e/tests/admin-dashboard.spec.ts` | deep | metrics, navigation, approval, needs-data removal |
| Owner-content moderation | owner editor and `/admin/moderation` | `e2e/tests/admin-moderation.spec.ts` | deep | clean publish, blocked publish, queue review |
| Submission enrichment lifecycle | admin submission review | `e2e/tests/admin-submission-enrichment.spec.ts` | deep | needs-data through approved brand with bilingual subcategories |
| Submission publishable-core guard | admin submission review | `e2e/tests/admin-submission-publishable-core.spec.ts` | deep | valid myship-only approval and no-channel rejection |
| Public API contracts | `/api/health`, `/api/search`, newsletter endpoints | `e2e/tests/api-contracts.spec.ts` | deep | status, result shape, validation, subscription lifecycle |
| Brand city badge | `/brands/[slug]` | `e2e/tests/brand-city.spec.ts` | deep | localized city display |
| Anonymous brand corrections | `/brands/[slug]` | `e2e/tests/brand-corrections.spec.ts` | deep | anonymous category proposal stays pending, duplicate guard, closed subcategory picker announces its refusal via `aria-describedby` and offers zero matches |
| Brand detail discovery | `/brands/[slug]` | `e2e/tests/brand-detail.spec.ts` | deep | sections, links, FAQ crawlability, `og:title`, locations, slugs, hidden brands |
| Brand save and unsave | directory, detail, `/dashboard` | `e2e/tests/brand-save.spec.ts` | deep | authenticated persistence and anonymous redirect |
| Claim lifecycle | claim routes and admin review | `e2e/tests/claim-lifecycle.spec.ts` | deep | domain verification, document rejection, ownership integrity |
| Critical claim smoke | claim routes and admin review | `e2e/tests/claim-smoke.spec.ts` | deep (`@smoke`) | community-brand claim and approval |
| Owned-brand editing | `/dashboard/brands/[slug]/edit` | `e2e/tests/dashboard-brand-owned-edit.spec.ts` | deep | wizard, draft persistence, uploads, governed fields |
| Dashboard quick actions | `/dashboard` | _uncovered_ | — | The four primary owner actions. `e2e/tests/dashboard-welcome-card.spec.ts` was removed on 2026-08-21 as low-value fixture-heavy coverage; nothing replaced it, so the journey is unowned at every layer. |
| Directory filtering and search | `/brands`, `/categories/*` | `e2e/tests/directory.spec.ts` | deep | L1 filters, autocomplete, taxonomy landing, empty states |
| Directory material facet | `/brands?material=` | `e2e/tests/directory-material.spec.ts` | deep | narrowing, chip clearing, facet survives a category click, unknown term emits no chip and no ItemList |
| Localized taxonomy copy | zh-TW and `/en` brand/directory surfaces | `e2e/tests/i18n-en.spec.ts` | deep | server-rendered and hydrated locale separation, final L1/L2 labels |
| MIT and owner verification badges | `/brands/[slug]` | `e2e/tests/mit-verification.spec.ts` | deep | mutually correct trust labels |
| Public data boundary | public HTML, RSC, JSON-LD | `e2e/tests/public-data-boundary.spec.ts` | deep | private fields absent across public surfaces |
| Bilingual search edge cases | directory and global search | `e2e/tests/search-edge-cases.spec.ts` | deep | ranking, CJK/English subcategories, typo, filters, stale responses |
| Share-card API | `/api/share-card/[slug]` | `e2e/tests/share-card-api.spec.ts` | deep | PNG dimensions, download headers, hidden/missing 404 |
| Account settings | `/settings` | `e2e/tests/settings.spec.ts` | deep | auth-gated form renders and the read-only email field carries the session's address |
| Brand share dialog | `/brands/[slug]` | `e2e/tests/brand-share.spec.ts` | deep | trigger exists on the page, readable URL value, copy label reverts after its timeout, dialog dismissal |
| Rendered-page SEO | `/brands`, `/en/brands`, `/brands?page=2` | `e2e/tests/seo.spec.ts` | deep | hreflang alternates and canonicals as SERVED, `og:url` equals canonical, unfiltered `/brands` emits `ItemList` JSON-LD |
| OG / twitter image routes | root, `/en/*`, `/zh-TW/og/trust/*` | `e2e/tests/og-images.spec.ts` | deep | middleware interception across both `src/proxy.ts` branches (`RESERVED_ROUTES` vs `isLocalizedPublicPath`) |
| Footer navigation | site footer on `/` | `e2e/tests/stories.spec.ts`, `e2e/tests/events.spec.ts` | deep | 專題 and 展會 links render inside `contentinfo` with the right `href` |
| Generated curated products — review and approval | admin submission review drawer | _uncovered_ | — | DEV-1469: proposals render, keep toggles, locked already-known rows, approval materializes ticked rows visible and unticked hidden |
| Generated curated products — brand backfill | `/admin/brands` | _uncovered_ | — | DEV-1469: multi-select, per-run cap, `Generate products for N selected brands`, products-scoped job enqueued |

## Pending verification

- Nothing pending. The DEV-1503 staging-run narrative that used to sit here described a run against deployed merge SHA `261b1667` and is no longer the state of the suite: the 2026-08-21 cleanup added and removed cases across `brand-corrections`, `brand-detail`, `community-submit`, `og-images`, `seo`, `settings`, `brand-share`, `stories`, and `events`, so those counts no longer describe anything. Re-run the canonical staging suite and replace this section with the new result.
