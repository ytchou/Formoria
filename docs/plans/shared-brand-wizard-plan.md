# Shared Brand Wizard and Romanized URLs

## Goal

Replace the duplicated dashboard-edit and detailed-submission wizard implementations with one shared four-section form, while keeping dashboard draft persistence and submission final-only persistence as separate adapters. Match the approved Links reference and carry `romanizedName` through brand storage and reviewed URL changes.

## Execution waves

1. Compose both flow schemas from shared field schemas and move Basic Info, Product Images, Links, and Locations to shared components.
2. Share step navigation, validation, completion, and URL synchronization while injecting the two persistence policies.
3. Add `brands.romanized_name`, review-aware slug changes, atomic redirects, cache invalidation, and submission persistence corrections.
4. Refresh Playwright journeys and run scoped unit, lint, type, migration, and E2E verification.

## Visual direction

- Keep Formoria's existing typography, semantic surface, border, spacing, radius, and shadow tokens.
- Make the Links page memorable through three compact channel cards whose fixed platform identity stays visually aligned with its URL input.
- Use existing iconography with restrained channel-specific color treatments; introduce named tokens instead of inline color values.
- Preserve 48px controls, visible focus treatment, and the reference's single-line rows at mobile and desktop widths.

```text
Section heading                          * required hint

┌ Social links ─────────────────────────────────────────┐
│ [icon] Instagram     [ URL                           ] │
│ [icon] Threads       [ URL                           ] │
│ [icon] Facebook      [ URL                           ] │
└────────────────────────────────────────────────────────┘
┌ Purchase links ───────────────────────────────────────┐
│ [icon] Official site [ URL                           ] │
│ [icon] Pinkoi        [ URL                           ] │
│ [icon] Shopee        [ URL                           ] │
└────────────────────────────────────────────────────────┘
┌ Other links ──────────────────────────────────────────┐
│ [ Label             ] [ URL                       ] × │
│ + Add link                                             │
└────────────────────────────────────────────────────────┘
```

## Acceptance

- Editing either shared section implementation changes both flows.
- Submission navigation performs no writes; dashboard navigation saves the current section draft.
- Other links require complete label/URL pairs and are submitted instead of discarded.
- Owners can influence URLs only through `romanizedName`; slug-changing edits require review and preserve old public URLs.
- Existing brands are backfilled from their slug, while `romanizedName` remains public-display metadata only.
