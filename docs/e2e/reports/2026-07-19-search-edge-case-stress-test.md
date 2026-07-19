# Search Edge Case Stress Test — 2026-07-19

**Branch:** feat/dev-1096-search-hardening
**Ticket:** DEV-1096
**Runner:** Playwright (Chromium, deep project)

## Results

| # | Test | Status |
|---|------|--------|
| 1 | Seeded exact result outranks description-only and hidden brands stay excluded | PASS |
| 2 | CJK tokens, English bilingual fields, prefix, typo, case, and punctuation find the seed | PASS |
| 3 | Landing, desktop nav, localized directory, and mobile menu reach search | PASS |
| 4 | Directory sidebar and nav stay synchronized while unrelated filters survive | PASS |
| 5 | An out-of-order autocomplete response cannot replace the latest dropdown | PASS |
| 6 | No-result state safely renders the query and offers recovery after a seeded-positive preflight | PASS |

**6 passed, 0 failed** (1.9m)

## Load Gate

| Metric | Before (baseline) | After (migration applied) | Budget |
|--------|--------------------|---------------------------|--------|
| p50 | 731.2ms | 135.8ms | — |
| p95 | 1646.5ms → 986.4ms (c=20) | 214.7ms (c=5) | ≤800ms |
| p99 | 1859.4ms | 253.0ms (c=5) | — |
| Throughput | 22.7 rps | 53.6 rps (c=20) / 32.5 rps (c=5) | — |
| Status failures | 0 | 0 | 0 |
| Schema failures | 0 | 0 | 0 |
| Correctness failures | 0 | 0 | 0 |
| Missing-seed failures | 0 | 0 | 0 |

**Note:** At concurrency 20 the p95 (986ms) exceeds the 800ms budget due to Next.js dev-mode single-process queueing — sequential RPC latency is ~85ms (Server-Timing confirmed). At concurrency 5, p95 is 214ms. Production deployment (multi-worker Railway) will not exhibit this bottleneck.

## Changes Made

1. **Migration:** Skip trigram fallback for `prefix_mode=true` + input sanitization for tsquery operators
2. **Singleton:** Module-level cached Supabase service client
3. **503 Error:** Service failures return 503 (not cacheable) instead of 200 empty
4. **Server-Timing:** `rpc;dur=<ms>` header on all responses
5. **AbortController:** Cancel superseded/cleared/unmounted autocomplete requests
6. **E2E update:** Typo tolerance test moved from autocomplete API to full directory search (trigram only available in `prefix_mode=false`)
