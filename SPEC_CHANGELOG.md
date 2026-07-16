# SPEC Changelog

## 2026-07-16

### DEV-1032 — Subcategory filtering + app_settings

Replaced stale `brand_taxonomy`/`TaxonomyTag` model with canonical-zh `product_tags` ontology. Added `?sub=` subcategory filtering on /brands (chips with counts, OR semantics, single-category gate). New `app_settings` table for runtime feature flags with admin kill switch at /admin. Sub-filtered views canonical to parent category. `search_brands` RPC gains `filter_tags` array overlap in all 3 branches + `mit-verified` fix.

### DEV-771 — Ownership dispute / admin revoke

Added BrandReport and OwnershipRevocation to Data Model. BrandReport.reason is CHECK-constrained (5 values including `ownership_dispute`); dispute reports carry `user_id` for reporter attribution. `owner_select_brand_reports` RLS excludes disputes from brand owners. `revoke_brand_ownership` SECURITY DEFINER atomically deletes the owner row, writes an audit row, and nulls `contact_email`.

## 2026-07-15

### DEV-1059 — BrandImage storage invariants

Rejection now deletes the storage object and nulls `storage_path` (rows kept as permanent dedup tombstones); all stored images are WebP at rest (≤1600px enrichment, ≤1200px owner uploads) via `processImage`; every storage upload sets `cacheControl: '31536000'`; owner-sourced images are excluded from auto-classification. Maintenance subcommands `audit|purge|reencode|purge-originals` live in `scripts/brand-storage-maintenance.ts`.

## 2026-07-10

- Standardized public UI horizontal gutters with the shared `page-gutter` utility: 24px on mobile and 40px from the medium breakpoint upward. Full-bleed sections retain their visual treatment while inner content follows the shared gutter; admin, dashboard, auth, and microsite shells remain separate.

## 2026-07-11

- DEV-975 — Restored multi-location brand views with explicit chain/independent classification. Only independent locations with confirmed coordinates appear on the map; chain and unclassified locations remain visible in separate non-map lists.

## 2026-07-06

- Removed legacy `brands.product_photos`, `brands.images_enriched_at`,
  `brands.serp_enriched_at`, and `brand_submissions.product_photos` columns from the
  documented model. Added `brand_images`, `brand_field_state`, and `brand_field_events`;
  documented `brands.description_en`; clarified enrichment is admin UI/CLI-triggered,
  not Railway cron-triggered.

## 2026-07-02

- DEV-925 — Added Owner Dashboard module (previously undocumented), including the
  Featured on Formoria growth section (embeddable badge + on-demand share card at
  `/api/share-card/[slug]`). New business rule 9: share assets only for approved brands.
  Observability: GA4 owner share events + badge referral UTM attribution.
  Decisions: `docs/decisions/2026-07-02-share-card-on-demand-imageresponse.md`,
  `docs/decisions/2026-07-02-share-card-email-via-remote-url.md`.

## 2026-06-28

- DEV-889 (2026-06-28) — MIT verification automated: replaced manual admin verification with
  dataset-backed cert lookup. Simplified mit_status to binary (unverified|verified). Removed
  claimed/rejected statuses and UBN columns.

## 2026-06-23

### DEV-877 — Submission workflow redesign

Replaced multi-step wizard with a single-screen flat form. The form collects only: brand URL, name, region, ownership declaration, PDPA consent, and optional social/purchase links. Fields removed from submission: description, product type, images, tags, UBN. Duplicate checking removed. Retail locations deferred to DEV-878.

Added batch enrichment pipeline: Railway cron service runs `pnpm curate enrich --status=pending` every 3 hours. Enrichment populates AI-derived product type, description, tags, images, and links before admin review. Admin submission queue now shows an enrichment status badge (`Not Enriched` / `Partially Enriched` / `Enriched`) on each pending submission.

`product_type` is now AI-classified by the enrichment pipeline, not submitter-selected. Admin may override post-enrichment.

## 2026-06-21

Added admin data curation module (9 operations), quality dashboard, auto-tag rule clarification.

## 2026-06-18

Refactored productTypes from array (via brand_taxonomy) to single product_type column on brands table.

## 2026-06-13

### DEV-807 — product_type governance changed from AI-only to submitter-selected

`product_type` is now submitter-selected from 10 flat categories (see `PRODUCT_TYPE_CATEGORIES` in `ontology.ts`). Free-text fallback via `product_type_note` when no category fits. Admin reviews taxonomy gaps in the submission queue. Previously: AI-tagged only; not shown in the submission form.
