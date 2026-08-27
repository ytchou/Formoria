# ADR: Product-level Made in Taiwan qualification

Status: accepted

## Context

The former architecture attached Taiwan-origin declarations and evidence to a
brand. Manufacturing origin is a product fact: different products from one brand
may be made in different places or use different primary materials. Brand-level
inheritance therefore overstates the available evidence.

## Decision

Made in Taiwan qualification belongs exclusively to curated products. A product
qualifies through either a fresh exact government-registry match or agreement
between the deterministic and LLM evaluators that the product is manufactured in
Taiwan and every primary material originates in Taiwan. Registry certification is
the explicit exception to the complete-material consensus rule; the public badge
still claims only manufacture.

Qualification is audit-backed and fail-closed. It does not control whether a
product can be published, does not affect editorial scores, and cannot promote a
candidate into the five finalists. The products phase reuses its existing LLM
call and stores both evaluator decisions for review.

The registry mirror preserves individual product/model variants, uses exact batch
matching, and becomes ineligible after 192 hours without a successful sync or
when expiry is missing, malformed, or passed. Public reads derive qualification
from the live registry relation or the two stored confirmation facts.

The brand-origin architecture, including brand MIT columns, origin evidence,
submission/review UI, filters, routes, analytics, and storage, is superseded and
removed. Existing production brand verifications are not copied to products.
Unrelated ownership verification remains unchanged.

## Consequences

- Evidence is narrower and may produce fewer badges, but each badge has a
  product-specific audit trail.
- Registry withdrawal and staleness remove registry-based claims automatically.
- Reviewers cannot manually force a badge; changing the assessed URL invalidates
  the recorded origin state.
- Publication remains available when evidence or audit logging fails.
- The two schema migrations must be deployed in order before the new runtime or
  product-level E2E journey is exercised.

## Rejected alternatives

- Brand inheritance: rejected because it silently qualifies unassessed siblings.
- Fuzzy registry matching: rejected because a near match can select the wrong
  model variant.
- A confidence score or manual override: rejected because neither proves both
  required facts.
- A second LLM call: rejected because the current products response can carry the
  bounded evaluations and proposals together.
- Migrating legacy brand verifications: rejected because those records do not
  establish product or complete-material origin.

## Pre-mortem

The fatal assumption is that a candidate's official URL identifies the exact
product and model being evaluated. Exact registry matching and URL invalidation
fail closed when that link changes. The likely silent break is stale registry
data appearing valid; one shared 192-hour budget governs qualification, cron
monitoring, and executive health.
