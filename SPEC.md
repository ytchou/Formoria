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
- Multi-step form: brand info → products → social links → review & submit
- Photo upload for brand logo and product images
- Structured taxonomy input: region selector (1 of 23 options) plus value checkboxes (max 3); replaces free-form tag suggestions
- Submission enters admin approval queue

### Admin
Content management and moderation.
- Submission review queue (approve/reject with notes)
- Brand listing management (edit, hide, delete)
- Taxonomy tag management (add, merge, rename)
- New tag suggestion review
- Content moderation dashboard (`/admin/moderation`) — pending flags with risk badges
- System health monitoring — real-time service status card showing health of all 8 integrated services (Supabase, Sentry, Resend, Turnstile, Tally, Browserless, Railway, Upstash Redis)

#### Admin god-mode ⇄ viewer-mode (DEV-764)
By default an admin operates in **god mode**: they may act as the **owner of any brand** through the owner dashboard UI, managing any listing without owning it. This is gated by auth primitives backed by an `fm_mode` cookie:
- `isActingAsAdmin(email) = isAdmin && !viewerMode` — true admin power, suppressible by viewer mode.
- `canManageBrand = isOwnerOf || isActingAsAdmin` — the per-brand management gate used by owner-path controls.
- `isAdmin` remains the pure, underlying source of truth (raw email check against `ADMIN_EMAILS`) and is never overridden.

A privilege-**reducing** **viewer mode** toggle lets the admin dogfood the real owner/visitor experience: when on, the admin is treated as a plain user — admin affordances are hidden and owner controls appear only on brands they truly own. Viewer mode can only ever **reduce** privilege, never grant it, so it is **not a security boundary** (it is a UX/dogfooding aid; server-side authorization still rests on `isAdmin`).

A global client-island indicator/exit bar, **`AdminModeBar`**, renders on every page to show the current mode and offer an exit. It reads the **non-httpOnly** `fm_mode` cookie in the browser, so static/ISR SEO pages stay static — `[locale]/layout` performs **no** server-side cookie read.

Middleware provisions `fm_mode=god` for real admins and deletes the cookie for non-admins. No DB migration is required.

## Business Rules
1. A brand must be approved by admin before appearing publicly
2. Only products manufactured in Taiwan qualify (not just Taiwanese-owned)
3. A brand can link to multiple sales platforms (no limit)
4. A brand can optionally list physical retail locations where products are sold
5. Taxonomy categories are admin-defined; brands can suggest new tags during submission (admin reviews and either adds or maps to existing)
6. Brand owners authenticate via Supabase Auth to manage their listing post-approval
7. Admin role is hardcoded (specific email addresses in env var)

### Taxonomy Closed Vocabularies (DEV-802)
- `region`: closed vocabulary of Taiwan's 22 cities/counties plus `全台灣`; max 1 per brand.
- `value`: closed vocabulary of admin-curated tags; max 3 per brand.
- `product_type`: Submitter-selected from 10 flat categories (see `PRODUCT_TYPE_CATEGORIES` in `ontology.ts`). Free-text fallback via `product_type_note` when no category fits. Admin reviews taxonomy gaps in the submission queue.
- `brand_submissions.suggested_tags` accepts the legacy `string[]` `suggestedTags` format for backwards compatibility.
- New structured submission format is `{ region?: string, values?: string[] }`, stored in the `brand_submissions.suggested_tags` JSONB column.
- On admin approval, accepted structured taxonomy is auto-applied to `brand_taxonomy`.

## Trust & Verification Model

A brand carries two **orthogonal** trust signals, plus an independent owner signal. They are computed and displayed separately and may coexist.

1. **Listing / approval status** (`brands.status`) — whether the brand is published in the directory. Managed via the admin approval queue (pending → approved | rejected | hidden). This governs visibility, not trustworthiness.

2. **MIT verification tier** (`brands.mit_status`: `unverified` | `claimed` | `verified` | `rejected`) — admin-verified against the **MIT 微笑標章 / MIT Smile** registry. When `verified`, the brand shows a gold **MIT 已驗證 / MIT Verified** badge. This is the registry-backed trust signal that resolves the self-attestation gap (see ASSUMPTIONS.md A7).

3. **Owner / brand-managed signal** (independent) — the badge formerly labeled "Verified" is now **品牌經營 / Brand-managed**, indicating the listing is claimed and maintained by its owner. Independent of MIT status; both badges may appear on one brand.

**Neutral Community absence:** a brand with neither the MIT nor the brand-managed badge displays a muted **社群品牌 / Community brand** label. Absence of a badge reads as intentional and complete, never as "missing" — MIT Smile certification is hard to obtain, so most brands legitimately lack it.

**Admin verification path:** owners may optionally submit a MIT 微笑標章 number on the claim form (`claim_requests.mit_smile_cert`). An admin verifies or rejects MIT status from the claim-review screen or per-brand on `/admin/brands` (service: `verifyMitStatus` / `rejectMitStatus`; server actions: `verifyMitAction` / `rejectMitAction`). v1 bulk import: admin-only CSV import page at `/admin/bulk-import` (DEV-806). MIT queue and middle tier still deferred to v2. v2 bulk-match lever = data.gov.tw dataset #6027.

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
- id, slug, name, description, logoUrl
- status: pending | approved | rejected | hidden (listing/approval signal)
- mitStatus: unverified | claimed | verified | rejected (MIT 微笑標章 verification signal — orthogonal to status)
- category (primary taxonomy tag)
- tags[] (additional taxonomy tags)
- purchaseLinks[] (platform, url, label)
- socialLinks (instagram, threads, facebook, officialWebsite)
- retailLocations[] (name, address, latitude, longitude) — optional
- productPhotos[]
- contactEmail (private, for admin communication)
- submittedAt, approvedAt, updatedAt

### TaxonomyTag
- id, slug, label, labelZh
- category: `product_type` | `region` | `value` (closed enum — DEV-802)
- isActive (admin can deactivate)
- suggestedBy (nullable, links to submission that suggested it)

### BrandSubmission
- id, brandId (nullable until approved)
- submitterEmail, submitterName
- status: pending | approved | rejected
- adminNotes (private)
- suggestedTags: `{ region?: string, values?: string[] }` JSONB (structured format, DEV-802); legacy `string[]` accepted for backwards compatibility
- submittedAt, reviewedAt, reviewedBy

## Compliance
- Taiwan PDPA: brand owners consent during onboarding (checkbox + privacy policy link)
- All collected data is business information (brand name, products, public social links)
- Contact email stored but never displayed publicly
- Brand owners can request deletion of their listing

## Observability
- PostHog: page views, filter usage, brand detail visits, submission funnel
- Sentry: error tracking with source maps
- Railway: built-in request metrics and logs
- In-app: Admin dashboard system status card — server-side health checks on demand (not a replacement for external dashboards)

## Performance Targets
- Initial page load: < 2s (LCP)
- Directory page with filters: < 1s response
- Brand detail page: statically generated (ISR), < 500ms
- Category pages: statically generated for SEO
