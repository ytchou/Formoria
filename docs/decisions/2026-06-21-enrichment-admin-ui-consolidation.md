# ADR: Enrichment admin UI consolidation

Date: 2026-06-21

## Decision
Consolidate the admin operations page to a single "Enrich" operation card and consolidate the CLI to a single enrichment command. Keep per-brand dropdown actions with phase flags for targeted fixes.

## Context
The admin operations page has 3 separate operation cards (`enrich-links`, `enrich-images`, `score-and-scrape`), and the CLI has 3 separate commands for related enrichment work.

## Consequences
- Advantage: Simpler operations page.
- Advantage: Unified pipeline runs all phases by default.
- Advantage: Per-brand actions still allow phase-specific fixes.
