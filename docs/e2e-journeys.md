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
| Product Made in Taiwan badge | brand, trail, and homepage product tiles | `e2e/tests/mit-verification.spec.ts` | deep | qualified product badge, unqualified sibling, and no brand inheritance |
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
| Anti-enumeration — adversarial | `/brands*`, `/sitemap.xml`, `/api/challenge/verify` | `e2e/tests/anti-enumeration-adversarial.spec.ts` | anti-enumeration | DEV-1551 task 18: 14 cases. Header spoofs, crawler-UA spoof, parallel and sequential crawls, invalid-slug probing, cookie rotation, verified-budget exhaustion, sitemap access, limiter outage fails open. Cases 2-4 document open finding 1 rather than asserting a fix. |
| Anti-enumeration — human sessions | `/brands*` across devices, locales and networks | `e2e/tests/anti-enumeration-human.spec.ts` | anti-enumeration | **Launch gate.** 13 cases, each asserting ZERO challenges. Desktop/mobile browsers, LINE and Instagram in-app, both locales, shared IP, multiple tabs, mid-session network change, filter journey, 20-brand journey. |
| Image proxy | `/i/[...path]` | `e2e/tests/image-route.spec.ts` | deep | DEV-1551: serves a public prefix with immutable caching, refuses `submissions/` even when the object exists, rejects traversal, and is exempt from the Cloudflare origin guard so Next's image optimizer can fetch it. Seeds its own objects. |

## Pending verification

- **DEV-1619's product-origin journey is authored but not executed.** Its two
  migrations are not present in the currently configured Supabase project, and
  the canonical suite accepts only isolated staging. Deploy the branch and
  migrations to staging, verify registry health and candidate audit linkage,
  then run `pnpm exec playwright test e2e/tests/mit-verification.spec.ts
  --project=deep`.

- **DEV-1551's three new specs have never been executed.** They are authored, and they pass `tsc`, `eslint` and `scripts/check-e2e-timeouts.mjs`, but `e2e/global-setup.ts` calls `validateStagingTarget`, which supports neither a local nor a production target: the suite is canonical only against the isolated deployed staging origin. That origin does not carry this branch, so the specs cannot run until it is deployed. The two anti-enumeration specs additionally need `SECURITY_DISABLE_RATE_LIMIT=false` so the shared server arms the limiter — without it they pass while asserting nothing, which is the failure mode to watch for:

  ```
  SECURITY_DISABLE_RATE_LIMIT=false pnpm exec playwright test --project=anti-enumeration
  ```

  `image-route.spec.ts` seeds and removes its own storage objects, so it does not depend on what the target's bucket already holds. That matters: staging's `brand-images` bucket contains only `curated-products/`, so any spec asserting against pre-existing `brands/` objects would 404 for the wrong reason and pass vacuously.

- The older DEV-1503 staging-run narrative that used to sit here described deployed merge SHA `261b1667` and no longer describes the suite: the 2026-08-21 cleanup added and removed cases across `brand-corrections`, `brand-detail`, `community-submit`, `og-images`, `seo`, `settings`, `brand-share`, `stories`, and `events`. Re-run the canonical staging suite and replace this section with the new result.
