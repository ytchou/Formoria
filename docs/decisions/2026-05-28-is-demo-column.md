# ADR: Use is_demo Boolean Column for Demo Brand Identification

Date: 2026-05-28

## Decision
Add an `is_demo BOOLEAN NOT NULL DEFAULT false` column to the brands table to identify demo/sample brands.

## Context
We need to seed demo brands for partner pitches while keeping them distinguishable from real brands for admin purposes and eventual cleanup.

## Alternatives Considered
- **Status enum extension ('demo')**: Add 'demo' to the status CHECK constraint. Rejected: muddies status semantics — status controls the approval workflow (pending/approved/rejected/hidden), not data origin. This is the same reasoning from ADR-2026-05-19-showcase-visibility-via-status-enum that rejected is_featured.
- **Separate demo_brands table**: Zero data pollution but requires duplicating the entire brands schema, queries, and type definitions. Massive overhead for 5 rows.

## Rationale
A boolean flag keeps concerns separated: `status` manages the approval lifecycle, `is_demo` manages data provenance. The pattern follows `isVerified` (also a boolean derived from brand metadata). Cleanup is trivial: `DELETE FROM brands WHERE is_demo = true`.

## Consequences
- Advantage: Simple, clean separation of concerns, easy cleanup
- Advantage: No changes to existing status-based filtering logic
- Disadvantage: One more column and migration, minor schema growth
