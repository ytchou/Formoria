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

## DEV-1739 no-go

The staging experiment added only the trimmed non-empty English product name,
then refreshed 1,193 product vectors and 226 dependent brand centroids. Both
the baseline and candidate corpus health checks reported zero missing, stale,
or orphaned product embeddings and centroids.

The fail-closed shared-consumer gate did not pass. Product neighbours met their
aggregate thresholds, but related brands averaged 1.49 retained results and
only 44.8% of anchors retained at least two. Four published trails also had no
staging placements, so the absolute all-trail gate could not pass. The one
populated changed trail retained 5/6 results.

Because a drift gate failed, relevance grading was not used to justify the
candidate and no English-name corpus migration was created. The seven-field
baseline view and embeddings were restored; a dry run found zero stale rows.
The compact evidence record is `dev-1739-no-go.json`. Full local snapshots were
not committed because they total roughly 3 MB and contain reproducible service
output for every product and brand anchor.

## DEV-1900 blind label review

At the user's request, the 30-pair manual spot check was replaced by three
independent Claude judges: Opus 5.5, Opus 5, and Sonnet 5.5. Each saw the same
query, brand, product name, and description without the existing LLM grade or
candidate rank. The input and rubric hashes, individual votes, majority grade,
model cost, and agreement are recorded in `dev-1900-panel.json`.

Of 30 pairs, 28 votes were unanimous and two were 2–1 majorities. No pair had
a three-way split. The panel changed five initial grades. Exact agreement with
the initial labels was 83.3%; quadratic-weighted Cohen's kappa was 0.9550,
above the 0.6 approval gate. The three model calls cost $0.194205 total. The
dataset approval provenance is `blind-llm-panel`, not a human label.

The remaining labels were completed in batches of up to 25 products per
query, with three independent audited OpenAI calls per batch. Incomplete
votes were retried; all 1,250 candidate pairs have three votes and each of
the 50 new queries has a relevant product. To check the batch method, the
same three Claude models judged another 30 blind pairs (10 each of brand,
keyword, and English queries, balanced between zero and positive grades).
Their 24 unanimous and six 2–1 votes changed six grades. The combined
60-pair agreement was 81.7% exact and quadratic-weighted κ=0.9444, above
the 0.6 gate. `dev-1900-batch-panel.json` records the second panel's
individual votes, costs, hashes, and combined agreement. The local audit
logs and full inputs remain gitignored.

## DEV-1900 scorer sweep and holdout

The 28-config train+validation sweep selected BM25F (k1=0.9, b=0.5;
A/B/C/D=1/1/0.5/0.25). Its NDCG@10 was 0.6124 versus 0.6013 for the best
weighted `ts_rank` arm; paired bootstrap BM25F minus `ts_rank` was +0.0111
with a 95% interval of [+0.0013, +0.0218]. Two 30-query staging latency
checks measured BM25F p95 within +50 ms of the same-index IDF arm, at
+46.9 and +49.5 ms. This is a narrow pass.

The v3 holdout compared BM25F with same-index IDF once, on 30 original and
10 new queries. Values below are BM25F minus IDF means:

| Slice / mode | NDCG@10 | MRR | Recall@100 |
| --- | ---: | ---: | ---: |
| Original / lexical | +0.0061 | -0.0022 | -0.0266 |
| Original / hybrid | -0.0117 | 0.0000 | -0.0057 |
| New / lexical | +0.1039 | +0.1524 | 0.0000 |
| New / hybrid | +0.0296 | 0.0000 | 0.0000 |

The original-slice no-loss gate failed. Original lexical recall@100 had a
paired 95% interval of [-0.0578, -0.0006]. BM25F is a scorer no-go, and
`20260930130000_lexical_scorer_idf_fallback.sql` restores IDF as the
staging default. `dev-1900-sweep.json` and `dev-1900-holdout.json` contain
the full per-query evidence. The index-only ship gate remains unverified:
no pre-index-migration v3 baseline was captured. A human ship decision is
pending; this result does not authorize production promotion.
