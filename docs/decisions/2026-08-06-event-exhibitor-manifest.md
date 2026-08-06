# Event-scoped exhibitor manifest

Date: 2026-08-06
Status: Approved for DEV-1370 implementation

## Decision

Add a service-role-only `event_exhibitors` relation as the canonical event
roster. An exhibitor is an event fact, not a Formoria brand. A nullable
`event_exhibitor_id` on `event_brands` keeps the existing brand-lineup contract
and placement columns compatible while allowing one canonical exhibitor to be
linked to at most one Formoria brand per event.

The public service will expose `getEventExhibitorEntries(slug)`, returning every
included exhibitor in source order with a hydrated `PublicBrandCard` or `null`.
The existing event page queries, counts, filters, analytics, and components do
not change in DEV-1370; the new contract is additive and is consumed by a later
DEV-1372 UI wave.

## Data and safety boundaries

- `event_exhibitors` has a foreign key to `events`, a stable `source_key`,
  official names, booth, area, zone, independent event category, source and
  website URLs, `verified_at`, and `sort_order`. The Creative Expo ledger
  namespaces the official detail-page ID as `creative-expo:<sourceId>`; booth
  assignment remains a separate mutable field.
- `unique (event_id, source_key)` is the identity boundary. A partial unique
  index on `event_brands(event_exhibitor_id)` allows at most one Formoria brand
  per exhibitor while permitting legacy rows whose link is still null.
- RLS is enabled with no anon/authenticated policies. Writes and reads go
  through the service-role service/seed paths.
- Event categories come only from the official event taxonomy; brand
  `product_type` is never used as a substitute.
- Hidden/deleted brands are omitted from the legacy linked result but remain in
  the new exhibitor result as an unlinked entry.

## Audit and source policy

Event metadata remains in `content/events/<slug>.json`. The authoritative
exhibitor ledger is a separate `*.exhibitors.json` file and is never parsed as
event metadata. Each ledger row records review priority, source evidence, and
exactly one terminal outcome (`matched_existing`, `included_unlinked`,
`excluded`, `needs_review`, or `out_of_scope`). Only the first two outcomes are
persisted in `event_exhibitors`; the ledger/report retains every terminal row so
exclusions remain auditable. Official checkpoint counts are report-time
evidence, not constants: K1 81, K2 57, K3 62, and S 100. Existing J2 links are
preserved as the only J2 entries.

The no-network audit command may suggest normalized-name/domain matches,
ambiguities, ledger invariant failures, and a coverage report, but it never
approves or edits outcomes. A human must recheck the official listing/handbook
before a refresh.

## Alternatives rejected

- Treating `event_brands` as the roster would make unmatched official
  exhibitors disappear and would couple event taxonomy to brand taxonomy.
- Creating new brands for every official row would pollute the directory and
  violate the confirmed-eligible-only boundary.
- Deriving event categories from `brands.product_type` would silently change
  the official event taxonomy whenever brand metadata changes.
- Scraping during seed would make a reproducible, reviewable ledger impossible
  and would couple deploys to external availability.

## Rollout and rollback

Apply the additive migration, regenerate database types, run the audit dry-run,
manually recheck same-day official sources, then seed/reconcile and revalidate.
No current page behavior changes. Rollback is dropping only the new additive
objects after unlinking `event_exhibitor_id`; existing event and brand rows are
left intact.

## Pre-mortem gate

The single assumption that would invalidate the feature is that the recovered
official source rows are complete and identity-stable. The audit report must
therefore show the exact K1/K2/K3/S totals and fail closed if a required zone,
duplicate source key, ambiguous match, or unresolved validation exists.

The most dangerous silent failures are pruning before a full exhibitor read,
linking two brands to one exhibitor, parsing an exhibitor ledger as event
metadata, and hiding a deleted brand from the canonical roster. The seed
preflight, partial unique index, separate loaders, prune ordering, and
unlinked fallback each cover one of these failure modes.
