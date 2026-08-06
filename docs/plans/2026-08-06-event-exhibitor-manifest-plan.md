# DEV-1370 — Event exhibitor manifest implementation plan

Date: 2026-08-06
Status: Approved; implementation on `feat/dev-1370-exhibitor-manifest`

## Scope

1. Add the additive Supabase migration and refresh generated database types.
2. Add the authoritative Creative Expo exhibitor ledger and separate event
   metadata/ledger loaders with pure invariant validation and coverage report
   generation.
3. Add a no-network audit command that proposes matches and writes a report
   without changing ledger outcomes.
4. Extend `seed-events` with exhibitor preflight, upserts, safe brand-link
   reconciliation, prune-last behavior, and exact post-write validation. Only
   `matched_existing` and `included_unlinked` rows enter the canonical table;
   all terminal outcomes remain in the ledger/report.
5. Add `EventExhibitorEntry` and `getEventExhibitorEntries(slug)` while keeping
   existing event brand-entry/count interfaces unchanged.
6. Add pure tests for ledger/coverage/safe-plan invariants and service tests for
   linked/unlinked/hidden fallback behavior. Integration gates use real test
   Supabase where configured; no Supabase mocks or React component tests.

## Dependency sweep

- Existing event metadata and linked-brand reads live in `src/lib/services/events.ts`.
- Existing seed validation and prune planning live in `scripts/seed-events.ts`.
- The only current event data file is
  `content/events/2026-taiwan-creative-expo.json`.
- Migration/type conventions are in `supabase/migrations/*events*` and
  `src/lib/supabase/database.types.ts`.
- Current event-detail UI and analytics callers remain unchanged until DEV-1372.

## Planned files

- `supabase/migrations/<timestamp>_event_exhibitors.sql`
- `src/lib/supabase/database.types.ts`
- `src/lib/services/events.ts` and `src/lib/services/events.test.ts`
- `scripts/seed-events.ts` and `scripts/seed-events.test.ts`
- `scripts/audit-event-exhibitors.ts` and its pure tests
- `content/events/2026-taiwan-creative-expo.exhibitors.json`
- `docs/reviews/event-exhibitor-audit-report.json`

## Verification

- `make doctor` (environment result recorded; missing local env may skip the
  external integration gate).
- Scoped pure service/seed/audit tests, then real test-Supabase integration
  tests if `SUPABASE_SERVICE_ROLE_KEY` and project are available.
- Existing event service tests.
- `pnpm lint`, `pnpm format:check`, `pnpm exec tsc --noEmit`, and `pnpm build`.
- Migration dry-run/local apply and representative linked/unlinked/prune
  operation, without `supabase db reset`.
- Existing event-detail E2E is deferred to the parent rollout gate because this
  wave intentionally does not alter UI behavior.

## Pre-mortem gate

Before implementation, ask: what if the official page is unavailable or the
recovered rows are incomplete? The ledger cannot be invented; the seed/audit
must fail with the exact missing source/coverage blocker. What breaks silently?
Unsafe pruning, ambiguous matching, duplicate source keys, and a hidden-brand
link disappearing from the new contract; each must have a pure invariant test
and a fail-closed runtime guard.

## Rollout checklist

Additive migration → type regeneration → audit dry-run → manual source
recheck/report regeneration → seed/reconcile/revalidate → verify unchanged
event page and new service contract. No scraper or frontend behavior is added
in this wave.
