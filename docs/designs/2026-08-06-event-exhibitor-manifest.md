# DEV-1370 design — canonical event exhibitor roster

## Contract shape

```text
event
 └─ event_exhibitors (official roster; every included row survives brand hiding)
      └─ event_brands.event_exhibitor_id (nullable compatibility link)
           └─ brands (optional public card; hidden/deleted resolves to null)
```

The event metadata file and exhibitor ledger are separate artifacts. The
metadata loader accepts only event fields; the exhibitor loader accepts only
the ledger schema. A ledger row carries its official names, booth, area/zone,
event category, source and website URLs, verification date, source order,
review priority, evidence, and one terminal review outcome. `source_key` is
derived from the namespaced official source ID when one is available; booth is
deliberately not used as identity because assignments can drift between source
refreshes.

`getEventExhibitorEntries(slug)` first resolves the published event's canonical
exhibitor rows, then batches brand hydration through the existing public brand
projection. It returns `brand: PublicBrandCard | null` for every row and sorts
by canonical `sortOrder`, then stable source key. Existing
`getEventBrandEntries`, counts, filters, analytics, and event-detail components
remain unchanged in this wave.

## Seed flow

1. Parse all event metadata and `*.exhibitors.json` ledgers before creating a
   client or writing anything.
2. Validate duplicate event slugs, duplicate source keys, official checkpoint
   coverage, terminal outcomes, matched-brand identities, required zones, and
   cross-event/conflicting links.
3. Resolve every event and brand identity in batches; a missing identity or
   incomplete required zone aborts and disables pruning.
4. Upsert exhibitors and then upsert/repoint compatibility `event_brands`
   links, dual-populating placement columns from canonical exhibitor data.
5. Prune stale compatibility links only after all writes and full validation;
   never prune a row when the plan is incomplete or ambiguous.
6. Re-read exact source keys, links, and counts and fail non-zero unless the
   database matches the ledger. Repeated runs produce no logical changes.

## Service and security

The migration enables RLS without public policies. Service-role access remains
behind the service layer. Event categories are copied from the official ledger;
brand product taxonomy is not read by the new contract. The partial unique
index on `(event_id, event_exhibitor_id)` enforces one linked Formoria brand per
exhibitor without disturbing legacy rows whose link is null.

## Verification and pre-mortem

Pure tests cover malformed outcomes, missing included metadata, invalid K/S
states, ambiguous matches, coverage drift, unsafe pruning, and non-idempotent
plans. Service tests cover linked/unlinked entries and hidden-brand fallback.
Migration/integration tests use real test Supabase when credentials are
available; no Supabase mocks or React component tests are used.

The failure assumption is source completeness: if the official listing cannot
be recovered or its checkpoint totals do not match, the ledger and seed stop
with the exact coverage error. Silent risks are ledger/event conflation, early
pruning, duplicate source keys, and hidden brands disappearing from the
canonical roster; separate loaders, preflight, prune-last ordering, database
uniqueness, and nullable brand hydration address each one.
