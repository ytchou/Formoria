# Formoria — Technical Specification

## Stack
- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript (strict)
- **Database:** Supabase (Postgres, cloud-hosted)
- **Auth:** Supabase Auth (for admin + brand owner login)
- **Storage:** Supabase Storage (brand logos, product photos)
- **Styling:** Tailwind CSS 4 + shadcn/ui + Radix UI primitives
- **Maps:** Google Maps API (optional, brand detail page retail locations)
- **Hosting:** Railway (single Next.js service)
- **Package Manager:** pnpm
- **Analytics:** PostHog
- **Error Tracking:** Sentry

## Module Decomposition

### Landing Page
Marketing entry point at `/`. Faire-inspired design for first-time visitors.
- Hero section with tagline and CTA linking to `/brands`
- Horizontal category navigation tabs (links to `/brands?category=<slug>`)
- Search bar that redirects to `/brands?search=<query>` on submit
- Value props section (3-column grid on desktop)

### Directory
Primary discovery surface at `/brands`. Filterable brand listing with grid layout.
- Taxonomy-based filtering (category, product type, price range)
- Full-text search
- SEO-optimized category pages (static generation)
- Responsive grid layout (desktop: multi-column, mobile: single column)

### Brand Detail
Individual brand pages with rich content.
- Brand story / description
- Product highlights with photos
- Social media links (Instagram, Threads, Facebook)
- Purchase links (official site, Shopee, Pinkoi, etc.)
- Optional: Google Maps widget showing physical retail locations

### Onboarding
Self-serve brand submission flow.
- Single-screen flat form collecting: brand URL, brand name, region (1 of 23 options), ownership declaration, PDPA consent, and optional social/purchase links
- No description, product type, images, tags, or UBN required at submission — these are auto-enriched by the scheduled batch enrichment pipeline
- Submission enters Needs Data, is discovered by the six-hour scheduler, and reaches the admin approval queue after enrichment

### Admin
Content management and moderation.
- Operations overview (`/admin`) — an exact-count, linked triage ledger for submissions, moderation, claims, reports, active jobs, brands, and newsletter subscribers
- Quick operations on the overview — inspect the current enrichment queue and jobs
- Submission review queue (approve/reject with notes) — admins review submissions after enrichment, not before
- Enrichment status badge on each submission: `Not Enriched` | `Partially Enriched` | `Enriched` — indicates how much AI-derived data has been populated before the admin makes a decision
- Batch enrichment pipeline: Railway runs the full submission enrichment pipeline every six hours. Admins may request a reviewed refresh for an approved or hidden brand; `pnpm curate enrich --slugs=...` creates the same scheduled refresh request and never writes directly to a live brand.
- Brand listing management (edit, hide, delete)
- Taxonomy tag management (add, merge, rename)
- New tag suggestion review
- Content moderation dashboard (`/admin/moderation`) — pending flags with risk badges
- Newsletter operations (`/admin/newsletter`) — status metrics, search/filtering, cursor pagination, safe CSV export, confirmation resend, and irreversible admin unsubscribe; email action tokens never reach the browser
- Feature toggles live at `/admin/settings`

#### Data Curation
Admin data curation uses the unified `enrich` operation. Long-running work runs through a durable background job system with progress persisted in `curation_jobs` and target-level state in `curation_job_targets`. New submissions and append-only brand refresh requests are discovered by the existing six-hour scheduler.

`/admin/jobs` is one reverse-chronological cursor-paginated log. Pending and running jobs can be cancelled cooperatively: worker leases, progress, finalization, and canonical brand/submission writes are fenced so provider work that returns after cancellation cannot become canonical. Stale jobs become cancelled without automatic retry. Dispatch and orchestration failures receive one linked automatic retry; manual reruns create additional linked attempts rather than rewriting job history.

The admin brand list exposes one confirmed **Request re-enrichment** action. It snapshots the current approved or hidden brand into a linked refresh submission; enrichment is staged for review and only an explicit **Apply refresh** updates the existing brand.

The quality dashboard tracks curation health metrics: hero image coverage, link coverage, description completeness, and completeness distribution.

#### Admin god-mode ⇄ viewer-mode (DEV-764)
By default an admin operates in **god mode**: they may act as the **owner of any brand** through the owner dashboard UI, managing any listing without owning it. This is gated by auth primitives backed by an `fm_mode` cookie:
- `isActingAsAdmin(email) = isAdmin && !viewerMode` — true admin power, suppressible by viewer mode.
- `canManageBrand = isOwnerOf || isActingAsAdmin` — the per-brand management gate used by owner-path controls.
- `isAdmin` remains the pure, underlying source of truth (raw email check against `ADMIN_EMAILS`) and is never overridden.

A privilege-**reducing** **viewer mode** toggle lets the admin dogfood the real owner/visitor experience: when on, the admin is treated as a plain user — admin affordances are hidden and owner controls appear only on brands they truly own. Viewer mode can only ever **reduce** privilege, never grant it, so it is **not a security boundary** (it is a UX/dogfooding aid; server-side authorization still rests on `isAdmin`).

A global client-island indicator/exit bar, **`AdminModeBar`**, renders on every page to show the current mode and offer an exit. It reads the **non-httpOnly** `fm_mode` cookie in the browser, so static/ISR SEO pages stay static — `[locale]/layout` performs **no** server-side cookie read.

Middleware provisions `fm_mode=god` for real admins and deletes the cookie for non-admins. No DB migration is required.

### Owner Dashboard
Post-claim management surface at `/dashboard` (protected; Supabase Auth; brand owners + god-mode admins per DEV-764).
- Feature-based tabs: Brand Profile (`/dashboard`), Analytics, Health, Verification; the active brand is selected via `?brand=<slug>` (ownership-guarded resolution, falls back to the first owned brand)
- Brand Profile tab composes editable listing sections (header, about, links, customer voices, product photos, retail locations)
- **Featured on Formoria growth loop (DEV-925):** approved brands get a share section with (a) an embeddable badge — static SVG plus a copy-paste dofollow snippet linking to the brand's public page with UTM params (`utm_source=badge&utm_medium=referral&utm_campaign=featured_badge&utm_content=<slug>`) — and (b) an auto-generated 1080×1350 share card served on demand at `/api/share-card/[slug]`. The claim-approved email surfaces both (card preview + download CTA + dashboard deep link)

## Business Rules
1. A brand must be approved by admin before appearing publicly
2. Only products manufactured in Taiwan qualify (not just Taiwanese-owned)
3. A brand can link to multiple sales platforms (no limit)
4. A brand can optionally list physical retail locations where products are sold
5. Taxonomy categories are admin-defined; brands can suggest new tags during submission (admin reviews and either adds or maps to existing)
6. Brand owners authenticate via Supabase Auth to manage their listing post-approval
7. Admin role is hardcoded (specific email addresses in env var)
8. Auto-tagging assigns product categories via keyword matching as an automated supplement to admin-defined taxonomy. Admin can override auto-assigned categories.
9. Share assets (badge snippet, share card) are exposed only for approved brands — hidden or pending brands never serve a share card (404) or show the badge section.

### Taxonomy & Product Classification

**Closed vocabularies (DEV-802):**
- `region`: closed vocabulary of Taiwan's 22 cities/counties plus `全台灣`; max 1 per brand.
- `value`: closed vocabulary of admin-curated tags; max 3 per brand.
- `product_type`: Each brand has exactly one L1 category, **AI-classified by the enrichment pipeline** (see `PRODUCT_TYPE_CATEGORIES` in `ontology.ts`). Stored as a column on `brands`; validated via CHECK constraint. Not submitter-selected.

**Product tags — canonical-zh ontology model (DEV-1032):**
- `brands.product_tags text[]`: canonical zh subcategory names (e.g. `['口金包', '手提包']`). AI-classified by enrichment; admin may override.
- `brands.product_tags_en text[]`: English translations, same order. Display-only.
- Ontology source of truth: `src/lib/taxonomy/ontology.ts` — defines `PRODUCT_TYPE_CATEGORIES[].subcategories[]` with `{ nameZh, nameEn, slug, aliases }`.
- Slug resolution: `subcategoryBySlug(slug)` and `resolveSubcategorySlugs(categorySlug, slugs)` map URL `?sub=` slugs to canonical zh names.
- GIN index `idx_brands_product_tags` enables `.overlaps()` and RPC `filter_tags` array overlap filtering.

**Subcategory filtering on /brands (DEV-1032):**
- URL: `?category=X&sub=Y` (comma-separated, OR semantics). Only active when exactly one L1 category is selected.
- `app_settings` table: runtime feature flag `subcategory_filter_enabled` (jsonb). Fail-open (default true on read error). Admin toggle at `/admin`.
- When enabled: subcategory chips with counts appear under the checked L1 category in the filter sidebar/drawer. Counts from `getSubcategoryCounts()`.
- Canonical URL: sub-filtered views point canonical + hreflang to the parent `/brands?category=X` (no `sub=`). Sitemap unchanged.
- `search_brands` RPC: `filter_tags` parameter filters all three query branches (FTS, trigram, EXCEPTION fallback).

**Submissions:**
- `brand_submissions.suggested_tags`: `{ region?: string, values?: string[] }` JSONB (structured format, DEV-802); legacy `string[]` accepted for backwards compatibility.

## Trust & Verification Model

A brand carries two **orthogonal** trust signals, plus an independent owner signal. They are computed and displayed separately and may coexist.

1. **Listing / approval status** (`brands.status`) — whether the brand is published in the directory. Managed via the admin approval queue (pending → approved | rejected | hidden). This governs visibility, not trustworthiness.

2. **MIT verification tier** (`brands.mit_status`: `unverified` | `verified`) — automatically verified via weekly dataset sync from data.gov.tw #6027. When `verified`, the brand shows a gold **MIT 已驗證 / MIT Verified** badge. This is the registry-backed trust signal that resolves the self-attestation gap (see ASSUMPTIONS.md A7).

3. **Owner / brand-managed signal** (independent) — the badge formerly labeled "Verified" is now **品牌經營 / Brand-managed**, indicating the listing is claimed and maintained by its owner. Independent of MIT status; both badges may appear on one brand.

**Neutral Community absence:** a brand with neither the MIT nor the brand-managed badge displays a muted **社群品牌 / Community brand** label. Absence of a badge reads as intentional and complete, never as "missing" — MIT Smile certification is hard to obtain, so most brands legitimately lack it.

**Automated verification:** a weekly cron syncs the government MIT dataset (data.gov.tw #6027) into a local `mit_registry` table. Brand owners submit their MIT 微笑標章 cert number via the dashboard, submission form, or claim flow. On submission, an instant exact lookup against `mit_registry` sets `mit_status` to `verified`; otherwise it remains `unverified`. No admin action required for MIT verification.

**Moderation under admin god mode (DEV-764):** when a god-mode admin edits a brand they do not own via the owner path, the edit runs `scanContent()` + `saveModerationFlags()` (same as any owner edit) and then immediately calls `markFlagsReviewed()` so the resulting flags are recorded as **auto-resolved** — `status='reviewed'` with `flag_reason` prefixed `admin-edit:`. This keeps a full audit trail but does **not** require human review. The tier-1 spam hard-block still applies to everyone, admins included. No DB migration is needed for this behavior.

### Content Moderation (DEV-804)

All brand submissions and owner edits pass through `scanContent()` (synchronous, in-process) before the record is persisted or queued.

**Tier 1 — hard block (applies to everyone, including admins):**
- Suspicious TLDs in URLs: `.tk`, `.ml`, `.ga`, `.cf`, `.gq`
- Excessive URLs: more than 3 URLs in any single text field
- Known English spam phrases (curated list in `moderation.ts`)

**Tier 2 — zh-TW flags (queued for admin review):**
- Contact injection: phone numbers or email addresses embedded in description/name fields
- Excessive emoji: more than 10 emoji characters in a single field
- Short or identical descriptions: description duplicates the brand name, or is under the minimum character threshold

**Auto-approval for trusted owner edits:**
- Owner edits with a clean tier-2 scan (no flags) AND `≥ TRUSTED_OWNER_THRESHOLD` (3) previously approved edits bypass the review queue and are applied directly.
- New brand submissions always enter the admin review queue regardless of scan result — auto-approval does not apply.

**Admin moderation dashboard (`/admin/moderation`, DEV-804):**
- Lists all pending moderation flags with risk badges (tier label + matched rule).
- Admins can approve or reject each flagged item inline.

### Brand Health Score (Internal Engagement Tool)

The Brand Health Score is an **internal engagement tool** surfaced to brand owners on their dashboard. It is NOT a public-facing signal and is never shown to consumers or used in search ranking. It is orthogonal to the Trust & Verification Model.

7 weighted dimensions: Profile Completeness (25%), Engagement Health (15%), Brand Story (15%), Photo Quality (15%), Social Presence (10%), Purchase Accessibility (10%), Click-Through Rate (10%).

Score range: 0-100. Tiers: Getting Started (0-39), Growing (40-69), Thriving (70-89), Exemplary (90-100).

See `docs/strategy/brand-success-playbook.md` for full specification.

## Data Model (Conceptual)

### Brand
- id, slug, name, description, description_en, logoUrl
- status: pending | approved | rejected | hidden (listing/approval signal)
- mitStatus: unverified | verified (MIT 微笑標章 verification signal — orthogonal to status)
- product_type (single product category, validated against PRODUCT_TYPE_CATEGORIES — one of: fashion, bags-accessories, jewelry, beauty, home, food-drink, crafts, tech, outdoor, kids-pets)
- tags[] (additional taxonomy tags)
- purchaseLinks[] (platform, url, label)
- socialLinks (instagram, threads, facebook, officialWebsite)
- retailLocations[] (name, address, latitude, longitude) — optional
- contactEmail (private, for admin communication)
- submittedAt, approvedAt, updatedAt

### BrandImage
- id, brand_id
- url, storage_path, source_url
- source: scrape | google_image | owner | admin | legacy
- status: active | rejected
- tags[], score, sort_order
- createdAt, updatedAt

Storage invariants (DEV-1059):
- Setting `status = 'rejected'` deletes the storage object and nulls `storage_path` in the same step. Rejected rows are permanent dedup tombstones — they are never reactivated or re-queued for classification.
- All stored images are WebP re-encoded via `processImage`: longest edge ≤1600px for enrichment/SERP images, ≤1200px for owner uploads.
- Every storage upload carries `cacheControl: '31536000'` (filenames are UUIDs, safe to cache 1 year).
- Owner-sourced images (`source = 'owner'`) are never auto-classified or auto-rejected by the enrichment pipeline.

### BrandFieldState
- brand_id, field
- source: owner | submitted | enriched | admin
- admin_locked
- updated_by, updated_at

### BrandFieldEvent
- id, brand_id, field
- old_value, new_value
- source, actor, job_id
- created_at

### AppSetting (DEV-1032)
- key (text PK)
- value (jsonb)
- updated_at (timestamptz)

### BrandSubmission
- id, brandId (nullable until approved)
- submitterEmail, submitterName
- status: pending | approved | rejected
- adminNotes (private)
- suggestedTags: `{ region?: string, values?: string[] }` JSONB (structured format, DEV-802); legacy `string[]` accepted for backwards compatibility
- submittedAt, reviewedAt, reviewedBy

### BrandReport
- id, brand_id, reason, notes, status, user_id (nullable), created_at
- reason CHECK constraint: `not_mit | incorrect_info | broken_link | inappropriate | ownership_dispute | removal_request`
- user_id: nullable FK to auth.users (SET NULL on deletion) — populated for `ownership_dispute` and `removal_request` reports (sign-in required)
- RLS: `owner_select_brand_reports` excludes ownership disputes and removal requests so brand owners cannot see sensitive brand-representative reports about their own brand

### OwnershipRevocation
- id, brand_id, revoked_user_id, revoked_user_email, revoked_by (admin email TEXT), reason, revoked_at
- Written atomically with the `brand_owners` row deletion by `revoke_brand_ownership` SECURITY DEFINER function
- Invariant: an `ownership_revocations` row always exists when a `brand_owners` row is deleted via admin revoke — never one without the other
- `revoke_brand_ownership` also nulls `brands.contact_email` (repopulated on re-claim)

## Compliance
- Taiwan PDPA: brand owners consent during onboarding (checkbox + privacy policy link)
- All collected data is business information (brand name, products, public social links)
- Contact email stored but never displayed publicly
- Brand owners can request deletion of their listing

## Observability
- PostHog: page views, filter usage, brand detail visits, submission funnel
- Sentry: error tracking with source maps
- Railway: built-in request metrics and logs
- In-app: admin operations pages expose queue and job state; service monitoring remains in the external operations stack
- CI/CD alerting: Agent Hub records nightly E2E results; GitHub Issues provide the failure audit trail

## Performance Targets
- Initial page load: < 2s (LCP)
- Directory page with filters: < 1s response
- Brand detail page: statically generated (ISR), < 500ms
- Category pages: statically generated for SEO
## Personal OS executive integration

Formoria `/admin` owns operational workflows. Personal OS consumes separate business, analytics, system-status, feedback, and marketing projections through bearer-protected, `no-store` internal routes. Authentication always precedes provider or database access. Formoria owns PostHog Query API credentials and returns a versioned, provider-neutral analytics snapshot; Personal OS never receives PostHog secrets.

Public discovery metrics use complete Asia/Taipei windows ending yesterday. PostHog is the sole queried analytics source, while GA4 remains installed and collecting for possible future advertising use. The legacy executive route, local analytics storage, and Growth Pulse artifacts remain temporarily available only until production proxy, privacy, event-shape, and saved-insight reconciliation gates pass.
