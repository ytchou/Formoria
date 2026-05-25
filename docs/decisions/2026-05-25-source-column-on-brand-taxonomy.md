# ADR: Source tracking via column on brand_taxonomy junction table

Date: 2026-05-25

## Decision
Add a `source` column (`text CHECK (source IN ('auto', 'manual', 'suggested'))`) to the existing `brand_taxonomy` junction table to track how each tag assignment was created. Default: `'manual'`.

## Context
To implement a bulk review queue for auto-assigned tags, we need to distinguish assignments made by keyword matching from those made by admins or brand submissions. Two approaches were considered: augmenting the existing junction table vs. creating a separate audit or review table.

## Alternatives Considered
- **Separate `tag_review` table**: A dedicated table tracking review state per assignment (pending, confirmed, rejected), with a FK into `brand_taxonomy`. Rejected — adds a join to every tag query, requires additional service layer complexity, and is over-engineering for a dataset of <500 brands where the source of a tag rarely matters after it's been confirmed.
- **Soft-delete + re-insert pattern**: Delete auto rows and re-insert as manual on confirmation. Rejected — loses provenance history and makes bulk review harder (can't query "show me all auto-assigned brands").

## Rationale
A single column on the junction table is the minimal change that enables:
1. Querying `brand_taxonomy WHERE source = 'auto'` for the bulk review queue
2. Updating `source = 'manual'` when admin confirms an assignment
3. Tracing suggestions back to `brand_submissions` via `source = 'suggested'`

The junction table already has two FKs and a composite PK. Adding `source` with a CHECK constraint keeps the schema flat and query-friendly. If provenance needs become more complex later (confidence scores, timestamps, who reviewed), a separate audit table can be added without breaking this design.

## Consequences
- Advantage: No additional joins in the tag read path.
- Advantage: Bulk review query is a simple `WHERE source = 'auto'`.
- Advantage: Zero migration risk — adding a nullable-defaulted column is non-destructive.
- Disadvantage: No timestamp or reviewer identity tracked per review action. Acceptable at current scale.
- Disadvantage: If we add confidence scores or multi-step review states later, this column will need to be extended or supplemented.
