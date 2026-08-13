# ADR: DEV-1444 TGOS Exact-Pin City Maps

Status: accepted, implementation blocked by prerequisite gate

Date: 2026-08-13

## Decision

Use TGOS for clustered exact-pin maps on `/where-to-buy/[city]` only. The
existing city page remains the source of truth: it applies the current
category filter, renders `DistrictSection`/`StockistRow`, and provides
`LocateButton` and Google destination links. `StockistCityMap` is inserted
after the category filters, receives that same filtered result, synchronizes
with the filter, and shows mapped/total counts. It reuses `DistrictSection`,
`StockistRow`, `LocateButton`, the existing filter styles, `SurfaceCard`, and
`Skeleton`. The list remains visible and is the fallback when coordinates,
persistence, or the map SDK is unavailable.

Geocoding is exact-only with TGOS county/town locking. Fuzzy, nearest, or
ambiguous results are never persisted. `StockistLocation` gains only optional
provider-neutral `latitude` and `longitude`.

Geocode columns live directly on `brand_channels` and are exactly:

```sql
latitude double precision,
longitude double precision,
geocoded_at timestamptz,
geocode_provider text,
geocode_precision text,
geocode_metadata jsonb
```

Latitude and longitude must be persisted as a pair. A database-level address
change trigger/guard atomically clears all six derived fields whenever
`brand_channels.address` changes. There is no separate coordinate table and no
address-fingerprint column or schema. The existing
`upsert_enriched_brand_channels` RPC is not extended.

The separate geocode service writes only through the service-role-only RPC
`update_brand_channel_geocodes(p_updates jsonb)`. The bounded machine-authorized
endpoint is exactly `POST /api/internal/geocode-brand-channels`; it accepts
`dryRun`, `cursor`, and `limit`, requires no city, processes at most 100 rows
per request in concurrency groups of five, and returns progress, failures, the
next cursor, and coverage. Its companion CLI has the same bounded flow and is
dry-run by default, requiring an explicit live opt-in for persistence.

Every TGOS external call stays behind the audited adapter boundary and records
sanitized request/response payloads, latency, HTTP status, and outcome.

This decision does not authorize implementation yet. As of 2026-08-13 there
are no TGOS credentials, TGOS approval, persistent-storage permission, or
benchmark evidence in the repository or local environment. Schema and
application work is blocked until those hard prerequisites are supplied.

## Environment and prerequisites

The TGOS-specific environment contract is exactly:

| Variable | Boundary | Purpose |
| --- | --- | --- |
| `TGOS_GEOCODING_APP_ID` | server | approved geocoding application id |
| `TGOS_GEOCODING_API_KEY` | server | approved geocoding credential |
| `NEXT_PUBLIC_TGOS_MAP_APP_ID` | browser | approved map application id |
| `NEXT_PUBLIC_TGOS_MAP_API_KEY` | browser | approved map credential |

Existing Supabase and repository machine-authorization settings remain existing
infrastructure; no TGOS base URL or alternate key variable is introduced.

Implementation is gated on TGOS approval and credentials, permission to
persist the six derived `brand_channels` fields, attribution/retention terms,
a dedicated local or remote Supabase test project, and reviewed benchmark
evidence. Benchmark in this order: 33 known addresses, then all eligible
Taiwan rows. Acceptance is `>=90%` exact matches overall and `>=80%` for every
represented city, with numerator/denominator evidence; missing city evidence
fails closed.

## Context

The directory has city-scoped stockist data and filters, but no approved exact
pin map. The design must prevent a wrong pin from being mistaken for a valid
location, avoid provider types in the domain model, and avoid a second write
path competing with enriched channel updates. Address edits must invalidate
derived coordinates at the database boundary rather than relying on a caller
to remember to clear them.

## Interfaces and trust boundaries

The adapter normalizes TGOS responses into provider-neutral coordinates and
metadata. It accepts the source address plus county/town lock and returns an
exact result or a visible failure classification; TGOS request/response types
do not cross into `StockistLocation`, the city page, or the RPC payload beyond
the approved provider-neutral metadata JSON.

The service owns cursoring, dry-run/live policy, limits, five-at-a-time
concurrency, coverage, failures, and the call to
`update_brand_channel_geocodes(p_updates jsonb)`. That RPC is callable only by
the service role. The map read path uses the existing brand-channel directory
query and projects optional latitude/longitude; it does not call TGOS.

## Execution order

1. Close the credential, TGOS approval, storage-permission, benchmark, and test
   project gates.
2. Add the six columns directly on `brand_channels`, paired-coordinate and
   atomic address-invalidation database rules, the service-role-only RPC, and
   optional coordinates on `StockistLocation`.
3. Add the audited exact TGOS adapter, separate geocode service, exact internal
   endpoint, and dry-run-by-default bounded CLI; leave
   `upsert_enriched_brand_channels` unchanged.
4. Run the 33-address benchmark, then all eligible Taiwan rows, persist only
   after permission, and enforce both coverage thresholds.
5. Add `StockistCityMap` after category filters with synchronized filtered
   data, mapped/total counts, clustering, and the existing list fallback.
6. Remove named obsolete scaffold/dependency/config/spec artifacts while
   preserving Google destination links. Defer Playwright E2E authoring and
   execution to `/e2e-author` per `executing-plans`.

## Rejected alternatives

- **Google Maps:** rejected for this ticket's map/geocode provider and
  provenance contract; preserve existing Google destination links.
- **Leaflet + OpenStreetMap:** rejected because it adds an unapproved tile,
  attribution, and OSM CSP/operational surface rather than using TGOS.
- **MapLibre:** rejected because it adds a separate renderer/tile dependency
  stack outside the approved TGOS map.
- **Nationwide embedded map or unbounded nationwide geocoding:** rejected; the
  approved flow still runs a bounded all-eligible-Taiwan benchmark/persistence
  pass after the 33-address benchmark, but never embeds a nationwide map or
  permits an unbounded job.
- **Fuzzy or nearest-address matching:** rejected; only TGOS exact matches with
  county/town locking may be persisted.
- **Brand-detail maps:** rejected; this release is limited to city directory
  discovery and keeps brand-detail scope unchanged.

## Cleanup and consequences

Wave 4 must explicitly review and remove, when stale and unused:

- `react-simple-maps`, its type declaration, configuration, and suppressions;
- `topoId` and the obsolete Taiwan-map data path;
- OSM CSP allowance;
- the unused Google API key and unused Google map service-registry entry; and
- stale map/brand-location specs.

Google destination links in `StockistRow` remain. Exact-only matching may leave
some locations list-only; that is intentional and visible through mapped/total
counts. Provider-neutral columns and the adapter boundary preserve the option
to change providers later without changing the directory contract.

## Pre-mortem and silent failures

The single assumption that would make this fail entirely is that TGOS approval,
credentials, storage permission, and benchmark evidence will arrive. If any is
missing, implementation must remain blocked. The most dangerous silent failure
is a stale or wrong pin after an address edit; atomic database invalidation,
paired-coordinate constraints, county/town locking, exact-only persistence,
benchmark gates, audit records, and the visible list fallback are independent
controls.
