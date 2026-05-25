# ADR: Admin-only tag authority for brand taxonomy

Date: 2026-05-25

## Decision
Only admins can assign, change, or remove tags from brands. Brand owners may suggest tags via the submission form's `suggested_tags` field, but not apply them directly.

## Context
The `brand_taxonomy` junction table has no mutation code path — all existing rows come from SQL seeds. As we build the first tag assignment workflow, we had to decide who controls tag assignment. The options were: admin-only, brand owner self-tag (with or without review), or community voting.

## Alternatives Considered
- **Brand owner self-tag without review**: Rejected — lowest admin burden but highest risk of incorrect or gamed tags. Brands could miscategorize to appear in popular categories.
- **Brand owner self-tag with admin review**: Rejected — adds reviewer workload for every brand edit while providing limited value over admin-curated tags. At 352 brands and slow growth, doesn't justify the complexity.
- **Community suggestions with voting**: Rejected — over-engineering for current scale. No community infrastructure exists.

## Rationale
Admin-only is consistent with the existing approval queue pattern (`brand_submissions` → admin review). Tag quality directly affects user trust and SEO value of category pages. At <500 brands, the admin workload is manageable. The bulk review queue and per-brand editor in this design make admin assignment efficient. Brand owners retain influence through the `suggested_tags` field.

## Consequences
- Advantage: Highest tag quality. Consistent with existing governance model. Clear accountability.
- Advantage: No brand-facing UI changes needed for core tag assignment.
- Disadvantage: Admin must triage all 90 unmatched brands manually (mitigated by keyword improvement reducing this number first).
- Disadvantage: May need to revisit at scale (500+ brands) — self-tagging with review could become necessary.
