# ADR: Server Action over API Route for Job Execution

**Date:** 2026-06-27
**Status:** Accepted
**Ticket:** DEV-888

## Decision

Consolidate admin enrichment job execution into `startCurationJobAction` Server Action (awaited), deleting the `run-job/route.ts` API route.

## Context

The admin UI triggers enrichment jobs via a POST to `/api/admin/run-job/route.ts`, which calls `runJob(job)` without awaiting it and returns 202 immediately. On Railway, the runtime kills the process after sending the response — the job never executes. Progress polling (3s interval) never sees updates, creating a polling storm with dozens of DB queries per minute.

The CLI path (`scripts/curate-brands.ts`) works correctly because it awaits the enrichment directly.

## Alternatives Rejected

1. **API route with `await`** — Works but leaves an unnecessary HTTP hop between the Server Action caller and the job runner. A Server Action is strictly simpler (same process, no serialization).
2. **CLI-only (remove UI trigger)** — Too much friction for admin operations. Admins need a one-click path.
3. **SSE/streaming progress** — Overkill for an admin-only feature processing 10-50 brand batches. Structured console logging visible in Railway is sufficient.

## Rationale

- Eliminates the HTTP hop that caused the fire-and-forget bug
- Consolidates trigger paths (UI and CLI both await enrichment directly)
- Integrates with React loading states (`useTransition`) for free
- Structured console logging replaces DB-based progress polling

## Consequences

- Long-running enrichment (100+ brands) may hit Vercel/Railway request timeouts — use the CLI path for large batches
- No real-time progress in the UI — admins check Railway logs for per-brand progress
- Net code reduction: delete API route, remove polling logic, remove progress parsing
