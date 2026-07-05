# SPEC Changelog

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
