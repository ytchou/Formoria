# SPEC Changelog

## 2026-06-18

Refactored productTypes from array (via brand_taxonomy) to single product_type column on brands table.

## 2026-06-13

### DEV-807 — product_type governance changed from AI-only to submitter-selected

`product_type` is now submitter-selected from 10 flat categories (see `PRODUCT_TYPE_CATEGORIES` in `ontology.ts`). Free-text fallback via `product_type_note` when no category fits. Admin reviews taxonomy gaps in the submission queue. Previously: AI-tagged only; not shown in the submission form.
