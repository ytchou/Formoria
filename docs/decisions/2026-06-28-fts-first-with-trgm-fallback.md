# ADR: FTS-first with pg_trgm fallback search strategy

Date: 2026-06-28

## Decision
Use PostgreSQL FTS (tsvector/ts_rank) as the primary search mechanism, falling back to pg_trgm (word_similarity) only when FTS returns zero results.

## Context
The brand directory needed to expand search beyond name+description to include tags and categories, add stemming support ("bags" → "bag"), and scale beyond the current pg_trgm-only approach. Three strategies were evaluated.

## Alternatives Considered
- **Combined scoring (blend ts_rank + word_similarity):** Returns finer-grained ranking by combining both signals. Rejected: at ~422 brands, blended scoring adds complexity (score normalization, weight tuning) with negligible ranking benefit. Independent tunability is more valuable.
- **FTS-only (drop pg_trgm):** Simplifies to one search system. Rejected: loses typo tolerance and CJK support. pg_trgm handles CJK adequately at this scale; FTS has no built-in CJK tokenizer.

## Rationale
FTS-first with fallback is the standard PostgreSQL search pattern (used by GitLab, Discourse). It provides stemming and relevance ranking via FTS while preserving typo tolerance and CJK support via pg_trgm. The two systems are independently tunable (FTS weights vs similarity threshold). At ~422 brands, combined scoring provides no measurable ranking improvement.

## Consequences
- Advantage: Clean separation of concerns, standard pattern, independently tunable
- Advantage: CJK and typo queries gracefully degrade to pg_trgm
- Disadvantage: Mixed queries (typo + stemming, e.g. "taiwn bags") fall entirely to pg_trgm, losing FTS stemming benefit
- Disadvantage: Two search paths to maintain (though the fallback is the existing code)
