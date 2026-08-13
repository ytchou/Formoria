# DEV-1444 — TGOS Exact-Pin City Maps Implementation Plan

## Status and hard prerequisite

This plan is approved for implementation design, but implementation is blocked
until the prerequisite gate is closed. As of 2026-08-13, the repository and
local environment contain no TGOS credentials, TGOS approval or license
evidence, permission to persist TGOS-derived coordinates/provenance, or
benchmark evidence. Do not add schema, application code, migrations, tests,
configuration, or dependencies until those artifacts are supplied and the
persistent-storage permission is explicit.

The prerequisite packet must contain TGOS approval and credential details,
permission to persist the six derived `brand_channels` fields, a reviewed
benchmark corpus, TGOS attribution/retention terms, and a dedicated local or
remote Supabase test project. The benchmark starts with 33 known addresses and
then covers all eligible Taiwan rows.

## Scope and current directory behavior

Build a clustered TGOS map only on `/where-to-buy/[city]` (including localized
route variants). Today the city page loads `getStockistDirectory(category)`,
groups the result with `groupStockistsForCity`, and renders category filters,
`DistrictSection`/`StockistRow`, and `LocateButton`. Existing Google destination
links remain unchanged. The map receives the same city-and-category-filtered
locations and is inserted immediately after the city category filters. It
shows mapped/total counts and clusters only locations with an exact persisted
coordinate pair; the current district/list rendering remains visible as the
fallback and accessible detail.

The first release does not add maps to the `/where-to-buy` index, brand-detail
pages, or stats, and does not embed a nationwide map or run an unbounded
nationwide geocoding job. After the 33-address benchmark and prerequisite gate,
the required bounded flow does cover all eligible Taiwan rows for benchmark
and persistence. It does not use fuzzy or nearest-address matching. A missing
or failed map never hides the current directory.

## Data model and interfaces

Coordinates and metadata stay provider-neutral at the domain boundary. Extend
`StockistLocation` with only optional `latitude?: number` and
`longitude?: number`; do not expose TGOS SDK types or provider-specific fields
through that type.

The six geocode columns live directly on the existing `brand_channels` table,
with exactly these database types:

```sql
latitude double precision,
longitude double precision,
geocoded_at timestamptz,
geocode_provider text,
geocode_precision text,
geocode_metadata jsonb
```

Latitude and longitude are a pair: the database must reject or normalize any
write that supplies only one coordinate. A database-level address-change
trigger/guard atomically invalidates all six derived fields whenever the
channel address changes, in the same database operation. Do not add an
address-fingerprint column, a separate coordinate table, or a second location
store.

The TGOS adapter is behind a provider-neutral exact-lookup service. It locks
the lookup to the source county/town and returns either an exact coordinate
pair plus provider-neutral metadata or a visible `not_found`, `ambiguous`,
`fuzzy`, or provider-error result. Fuzzy results are never persisted. The map
read path uses the existing brand-channel query/service and projects only
optional latitude/longitude into `StockistLocation`.

Geocode writes use exactly one separate, service-role-only RPC:

```text
update_brand_channel_geocodes(p_updates jsonb)
```

The payload is a bounded batch of channel ids and the six approved derived
values. Do not extend `upsert_enriched_brand_channels`; the geocode service and
this RPC own geocode writes separately.

Provide one bounded internal operation, sharing the service implementation:

- `POST /api/internal/geocode-brand-channels`, machine-authorized, accepting
  bounded `dryRun`, `cursor`, and `limit` fields. It does not require a city.
  Each request processes at most 100 rows in concurrency groups of five.
  The response includes `progress`, `failures`, `next cursor`, and `coverage`.
- A `geocode-brand-channels` CLI with the same cursor/limit/dry-run flow. It is
  dry-run by default; persistence requires an explicit live opt-in. It uses the
  same 100-row request cap and groups work five at a time.

The TGOS adapter must use the existing `auditedCall` pattern and register a
TGOS geocoding operation. The audit event records sanitized request payload,
sanitized response payload, latency, HTTP status, and outcome; credentials and
unnecessary raw provider data are excluded.

The TGOS-specific environment contract is exactly:

| Variable | Boundary | Purpose |
| --- | --- | --- |
| `TGOS_GEOCODING_APP_ID` | server | approved TGOS geocoding application id |
| `TGOS_GEOCODING_API_KEY` | server | approved TGOS geocoding credential |
| `NEXT_PUBLIC_TGOS_MAP_APP_ID` | browser | approved TGOS map application id |
| `NEXT_PUBLIC_TGOS_MAP_API_KEY` | browser | approved TGOS map credential |

Existing Supabase and repository machine-authorization configuration remains
outside this ticket's four TGOS variables. No TGOS base-URL or alternate
single-key variable may be introduced.

## Execution waves

### Wave 0 — prerequisite and benchmark gate

Obtain TGOS approval/credentials, storage permission, attribution and
retention terms, the dedicated Supabase test project, and the reviewed address
corpus. Run the 33 known-address benchmark first. Only proceed to all eligible
Taiwan rows after the initial evidence is reviewable.

### Wave 1 — schema and provider-neutral service contract

Add the six columns directly to `brand_channels`, paired-coordinate database
invariants, and the atomic address-change invalidation. Add the service-role-
only `update_brand_channel_geocodes(p_updates jsonb)` RPC and regenerate types.
Extend `StockistLocation` only with optional latitude/longitude. Keep
`upsert_enriched_brand_channels` unchanged.

### Wave 2 — audited adapter and bounded geocode operations

Implement exact TGOS address lookup with county/town locking, normalize only
exact results, and audit the adapter. Add the exact internal endpoint and
dry-run-by-default CLI. Enforce 100 rows per request, concurrency groups of
five, cursor progress, visible failures, coverage, timeout, and machine auth.

### Wave 3 — persistence, coverage, and city map

After the storage gate, run the 33-address benchmark and then all eligible
Taiwan rows through the bounded service. Accept only `>=90%` exact matches
overall and `>=80%` for every represented city, publishing numerator,
denominator, failures, and city coverage. Add `StockistCityMap` immediately
after the city category filters, synchronized with those filters, with mapped/
total counts and clustered TGOS pins. Reuse `DistrictSection`, `StockistRow`,
`LocateButton`, existing filter styles, `SurfaceCard`, and `Skeleton`; retain
the current list/district fallback for no data, provider failure, SDK failure,
or degraded rendering.

### Wave 4 — named cleanup and handoff

Sweep imports, route references, and stale specs, then remove the obsolete
scaffold and explicitly review:

- `react-simple-maps`, its type declaration, configuration, and lint/ESLint
  suppressions;
- `topoId` and the obsolete Taiwan-map data path;
- any OSM CSP allowance;
- the unused Google API key and unused Google map service-registry entry; and
- stale map/brand-location specs.

Preserve Google destination links in stockist rows. Do not author or execute
Playwright E2E in this implementation wave. Per `executing-plans`, defer E2E
authoring and execution to `/e2e-author` after stable persisted fixtures,
credentials, and the reviewed city behavior are available.

## Verification and test plan

- Preserve current directory behavior: city routing and 404 behavior, city
  cards, category-filtered stockist/district rendering, `StockistRow` Google
  destination links, and `LocateButton` remain covered by the existing scoped
  directory tests. The map must consume the same filtered set, not a second
  unfiltered query.
- Use a real local or dedicated Supabase test project, never mocked Supabase,
  to verify the six `brand_channels` columns, paired coordinates, atomic
  invalidation of all six fields after an address change, and service-role-only
  RPC permissions.
- Test the service layer for county/town locking, exact-only acceptance,
  fuzzy/ambiguous rejection, coordinate pairing, cursor progress, 100-row
  bounds, five-at-a-time concurrency, dry-run default/live opt-in, coverage,
  failures, and city/category map projection. Do not add React component tests.
- At the external HTTP boundary, test the audited adapter's normalized result,
  sanitized request/response, latency, HTTP status, and failure outcomes.
- Test the exact endpoint and CLI contracts: machine authorization, bounded
  `dryRun`/`cursor`/`limit`, no city requirement, max 100 rows, next cursor,
  progress, failures, and coverage. Verify the CLI cannot persist by default.
- Run the 33-address benchmark, then the all-eligible-Taiwan run; fail closed
  unless overall coverage is at least 90% and each represented city is at
  least 80%, with evidence for every denominator.
- After implementation, run `git diff --check`, lint, type-check, scoped
  service/database tests, and the benchmark verification. E2E is a separate,
  deferred `/e2e-author` deliverable and is not run here.

## Silent-failure risks and controls

- An address edit could leave a plausible old pin: the database invalidates
  all six derived fields atomically whenever `address` changes.
- A partial coordinate write could plot an invalid point: enforce the paired
  latitude/longitude invariant at the database boundary and in the service.
- TGOS could return a nearby or wrong-county result: county/town locking and
  exact-only validation reject fuzzy, ambiguous, and mismatched candidates.
- A batch could silently exceed provider limits: the shared endpoint/CLI cap
  each request at 100 rows and concurrency groups at five, and returns progress,
  failures, next cursor, and coverage.
- A filtered map could disagree with the list: derive both from the same
  category-filtered directory result and show mapped/total counts.
- A map/provider failure could hide locations: preserve the current list,
  district sections, and destination links as the fallback.
- Audit or credential failures could be invisible: keep the adapter inside the
  audit envelope and redact secrets before logs or metadata persistence.
