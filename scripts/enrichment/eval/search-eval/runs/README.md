# search-eval run artifacts

Only ticket-named baseline files are committed (`dev-*.json`). Timestamped
run output (`*.json` without a `dev-` prefix) is gitignored.

## File layout (v2)

```
search-eval/
  dataset-v2.json          # graded dataset with splits (train/val/holdout)
  dataset-v2.ts            # loader + toExperimentItems converter
  retrieval-eval.ts        # CLI entry: run, neighbours, labelling subcommands
  runs/
    dev-1736-report.json   # LTR experiment report (from writeReport)
    dev-1733-before.json   # embedding baseline (pre-material labels)
    dev-1733-after.json    # embedding baseline (post-material labels)
```

## dev-1733-before.json / dev-1733-after.json

Produced on staging (project `ttkkyvgvcamfoezsetvf`) on 2026-09-15.

- Corpus: 995 eligible products, 20 golden queries, k=5
- Arms: `vector`, `lexical`, `hybrid`
- Before: six-field embedding document (migration `20260903100200`)
- After: seven-field document with material labels (migration `20260915130000`)
- Re-embedded: 730 products whose category is material-applicable and material
  is non-empty

Steps:

1. `pnpm embeddings:backfill --apply --all` (first-ever embed, ~995 rows)
2. `pnpm search:eval run --arm all` → renamed to `dev-1733-before.json`
3. `pnpm db:migrate` (applied `20260915130000` only)
4. `pnpm embeddings:backfill --apply --all` (re-embedded 730 stale rows)
5. `pnpm search:eval run --arm all` → renamed to `dev-1733-after.json`

## D6 gate (flexible)

| Metric | Before | After | Gate |
|--------|--------|-------|------|
| hybrid mean P@5 | 0.167 | 0.156 | SOFT FAIL (≥ 0.167) |
| hybrid mean MRR | 0.374 | 0.363 | PASS (≥ 0.354) |

Per-query MRR for the 9 material-led queries:

| Query | Before | After | Gate |
|-------|--------|-------|------|
| woodfired-ceramics | 1.000 | 1.000 | PASS |
| indigo-dye-bag | 0.000 | 0.000 | PASS |
| hinoki-home-decor | 0.000 | 0.000 | PASS |
| minimal-leather-wallet | 0.000 | 0.000 | PASS |
| wedding-gold-jewelry | 0.000 | 0.000 | PASS |
| linen-home-textile | 0.000 | 0.000 | PASS |
| laptop-canvas-bag | 0.000 | 0.000 | PASS |
| ceramic-incense-holder | 1.000 | 1.000 | PASS |
| handmade-silver-ring | 1.000 | 1.000 | PASS |

MRR within 0.02 tolerance; all 9 material queries held. P@5 micro-regressed
by 1 query position on 20 queries — D6 is marked flexible and defers to human
judgment at PR review. Langfuse was unavailable (404); both runs used the
local-only harness path.
