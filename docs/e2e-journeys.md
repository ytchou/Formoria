# Formoria E2E journey catalog

Last refreshed: 2026-08-19 (`DEV-1503`)

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
| Anonymous brand corrections | `/brands/[slug]` | `e2e/tests/brand-corrections.spec.ts` | deep | category and novel-subcategory proposals, duplicate guard |
| Brand detail discovery | `/brands/[slug]` | `e2e/tests/brand-detail.spec.ts` | deep | sections, links, FAQ, SEO, locations, slugs, hidden brands |
| Brand save and unsave | directory, detail, `/dashboard` | `e2e/tests/brand-save.spec.ts` | deep | authenticated persistence and anonymous redirect |
| Claim lifecycle | claim routes and admin review | `e2e/tests/claim-lifecycle.spec.ts` | deep | domain verification, document rejection, ownership integrity |
| Critical claim smoke | claim routes and admin review | `e2e/tests/claim-smoke.spec.ts` | deep (`@smoke`) | community-brand claim and approval |
| Owned-brand editing | `/dashboard/brands/[slug]/edit` | `e2e/tests/dashboard-brand-owned-edit.spec.ts` | deep | wizard, draft persistence, uploads, governed fields |
| Dashboard quick actions | `/dashboard` | `e2e/tests/dashboard-welcome-card.spec.ts` | deep | four primary owner actions |
| Directory filtering and search | `/brands`, `/categories/*` | `e2e/tests/directory.spec.ts` | deep | L1 filters, autocomplete, taxonomy landing, empty states |
| Localized taxonomy copy | zh-TW and `/en` brand/directory surfaces | `e2e/tests/i18n-en.spec.ts` | deep | server-rendered and hydrated locale separation, final L1/L2 labels |
| MIT and owner verification badges | `/brands/[slug]` | `e2e/tests/mit-verification.spec.ts` | deep | mutually correct trust labels |
| Public data boundary | public HTML, RSC, JSON-LD | `e2e/tests/public-data-boundary.spec.ts` | deep | private fields absent across public surfaces |
| Bilingual search edge cases | directory and global search | `e2e/tests/search-edge-cases.spec.ts` | deep | ranking, CJK/English subcategories, typo, filters, stale responses |
| Share-card API | `/api/share-card/[slug]` | `e2e/tests/share-card-api.spec.ts` | deep | PNG dimensions, download headers, hidden/missing 404 |

## Backlog

- DEV-1503 app-owned characterization: the live brand detail still rendered `類別` / `Category` and `產品類別` / `Product categories` on 2026-08-19 instead of the approved `品牌類別` / `Brand category` and `商品子類別` / `Product subcategory`. Correct the application copy before certifying this run; no E2E workaround should preserve the obsolete wording.
