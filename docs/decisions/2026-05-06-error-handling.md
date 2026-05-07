# ADR: Error Handling

**Date:** 2026-05-06
**Status:** Accepted
**Context:** DEV-544 — Service layer implementation

## Decision

Service functions throw typed errors from a `ServiceError` class hierarchy defined in `src/lib/errors.ts`.

The hierarchy:
- `ServiceError` (base) — generic service-layer error with a `code` property
- `NotFoundError` — entity not found (e.g., brand by slug)
- `ValidationError` — input validation failure (e.g., duplicate slug)

## Alternatives Considered

1. **Result\<T, E\> return type** — Explicit but verbose; every caller must unwrap. Does not integrate naturally with Next.js error boundaries or Server Actions.
2. **Mirror Supabase `{ data, error }` pattern** — Leaks the provider convention into the domain layer. Callers must null-check both fields.
3. **HTTP status codes as error types** — Couples the service layer to HTTP transport; inappropriate for server-side callers.

## Rationale

- Works naturally with Next.js error boundaries and Server Actions — thrown errors propagate to `error.tsx` boundaries.
- Callers in API routes catch and map to HTTP responses: `NotFoundError` -> 404, `ValidationError` -> 400.
- The `code` property enables programmatic error handling without string matching on messages.
- Keeps the service layer transport-agnostic — the same errors work whether called from API routes, Server Actions, or CLI scripts.

## Consequences

- Callers must wrap service calls in try/catch.
- No compile-time exhaustiveness checking (unlike discriminated union / Result types).
- New error types can be added by extending `ServiceError` without changing existing callers.
