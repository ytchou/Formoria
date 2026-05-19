# ADR: Simple Tag Merge Without Alias Table

Date: 2026-05-19

## Decision
Use existing mergeTag() which reassigns brand_taxonomy rows and deactivates the source tag. No alias/redirect table.

## Context
Taxonomy management needs tag merging. Could use simple reassignment or build an alias table for URL redirects.

## Alternatives Considered
- **Alias table (tag_aliases: old_slug -> new_slug)**: Adds schema complexity and lookup layer. Only justified if tag slugs appear in URLs -- they don't (tags are filter parameters, not route segments).
- **Soft merge (synonyms)**: Keep both active, mark as synonyms. Adds UI complexity for v1 with ~15 tags.

## Rationale
With <50 tags and no tag-based URLs, simple reassign+deactivate is sufficient. Alias table can be added later if tag URLs are introduced.

## Consequences
- Advantage: No schema changes, uses existing service function, simple mental model
- Disadvantage: No URL redirects. Deactivated tags remain in DB for audit but are invisible in filters.
