# ADR: Phased enrichment pipeline (discover → links → images)

Date: 2026-06-21

## Decision
Run brand enrichment as three sequential phases per brand: discover, links, and images.

## Context
The single-pass approach was rejected because it requires a new combined patch builder, is harder to debug, and mixes concerns across URL discovery, link enrichment, and image enrichment.

## Consequences
- Disadvantage: 2 DB writes per brand (links patch, images patch) instead of 1.
- Advantage: Each phase is independently retryable.
- Advantage: Clear separation of concerns between discovery, link scraping/fill, and image scraping/download.
