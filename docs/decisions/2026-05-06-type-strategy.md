# ADR: Type Strategy

**Date:** 2026-05-06
**Status:** Accepted
**Context:** DEV-544 — Service layer implementation

## Decision

Use `supabase gen types typescript` for auto-generated database types combined with hand-written camelCase domain types in `src/lib/types/`.

Service functions transform between the two layers at the boundary using inline mapper functions.

## Alternatives Considered

1. **Hand-write both layers** — Risk of drift between schema and TypeScript types when migrations change columns.
2. **Single-layer types with runtime deep-transform** — Loses type safety on nested JSONB fields (purchase_links, social_links, retail_locations).
3. **Shared type with conditional casing** — Overly complex generics for minimal gain.

## Rationale

- DB types stay in sync with the schema automatically via `supabase gen types` CLI.
- Domain types give a clean, framework-agnostic API surface with camelCase conventions.
- Inline mappers in each service file keep transformation logic co-located with the queries that produce the data.
- JSONB fields (purchase_links, social_links) get explicit TypeScript types at the domain layer, providing autocomplete and compile-time checks that auto-generated `Json` types cannot.

## Consequences

- Must run `supabase gen types typescript` after every migration.
- Each service file contains its own mapper functions (brandToDomain, tagToDomain, etc.).
- Adding a new column requires updating both the migration AND the domain type + mapper.
