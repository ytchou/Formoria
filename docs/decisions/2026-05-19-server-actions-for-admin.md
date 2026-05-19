# ADR: Server Actions for Admin Mutations

Date: 2026-05-19

## Decision
Use Next.js server actions (not API routes) for all admin mutations.

## Context
Admin dashboard needs ~10 mutation endpoints for submission approval/rejection, brand CRUD, and taxonomy management. Need to choose between server actions and API routes.

## Alternatives Considered
- **API routes (`/api/admin/*`)**: Duplicates service layer through HTTP boundary. Adds request/response serialization and a second auth layer. Only justified for external consumers (none exist).
- **Client-side fetching + API routes**: Adds client-side state management (loading, error, cache invalidation). Server actions with revalidatePath handle this natively.

## Rationale
Matches established pattern (`submit/actions.ts`), avoids API route proliferation, keeps mutations co-located with consuming pages, leverages React 19 useTransition for pending states.

## Consequences
- Advantage: Simpler data flow, no API layer to maintain, native React 19 integration
- Disadvantage: All mutations require server round-trip (no optimistic UI). Acceptable for admin workflows.
