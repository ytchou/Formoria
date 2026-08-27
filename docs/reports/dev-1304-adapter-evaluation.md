# DEV-1304 adapter evaluation

## Status

Live baseline and post-change measurements ran on 2026-08-27 against the
production brand catalog because the dedicated staging project contained none
of the 35 cohort brands. The evaluator made external scrape, Serper, image, and
OpenAI calls and emitted the expected audit spans. It did not create or update
brands, submissions, curated products, or stored images.

The baseline used commit `1bfc94394`; the post-change run used the PR worktree
with explicit `--local-render`. Generated JSON remained local under
`scripts/image-eval/runs/` and is intentionally uncommitted.

During evaluation, the metric filter was corrected to count only the requested
method (for example, `pinkoi_adapter`) instead of every method ending in
`_adapter`. Two live defects were also found and repaired before the final
post-change measurements:

- Pinkoi `220x220` CDN thumbnails are promoted to the supported `800x0` form so
  they can pass the 480px production gate.
- Relative MyShip `/i/cgdm/...` paths are resolved against the storefront URL
  instead of being discarded as invalid absolute URLs.

## Results

Values are `returned / gate-passing / classifier-kept`. Percentages are image
gate pass, classifier keep, and end-to-end image yield respectively.

| Adapter | Brands | Baseline | Post-change |
|---|---|---:|---:|
| Instagram | `seeseamylove`, `yarn-ball`, `memedo`, `quoin`, `tings-aroma` | 44 / 37 / 24 (84.1% / 64.9% / 54.5%) | 40 / 37 / 34 (92.5% / 91.9% / 85.0%) |
| Pinkoi | `seeseamylove`, `memedo`, `guaguaforest`, `tings-aroma`, `zenu` | 80 / 0 / 0 (0% / 0% / 0%) | 59 / 54 / 54 (91.5% / 100% / 91.5%) |
| Shopee | `yun-clean`, `man-man-soap`, `nsou`, `yi-fan-canvas-bags`, `my-beast` | 5 / 0 / 0 (0% / 0% / 0%) | 0 / 0 / 0 (render blocked) |
| MyShip | `an-ma`, `billnogates`, `lumirona`, `honestea`, `scent-forest` | 58 / 37 / 31 (63.8% / 83.8% / 53.4%) | 45 / 40 / 36 (88.9% / 90.0% / 80.0%) |
| Shopline | `zenu`, `satana`, `addable`, `inblooom`, `goodglas` | 0 / 0 / 0 | 6 / 2 / 0 (33.3% / 0% / 0%) |
| 91App | `clany`, `74ounce`, `a-mour`, `solis`, `erss` | 0 / 0 / 0 | 12 / 0 / 0 (0% / 0% / 0%) |
| Cyberbiz | `chih-tsui-fang`, `fluffystar`, `糖果屋幼教用品社`, `anta-pottery`, `buwu` | 0 / 0 / 0 | 29 / 17 / 8 (58.6% / 47.1% / 27.6%) |

Post-change gate rejection counts were:

| Adapter | Rejections |
|---|---|
| Instagram | `short_edge`: 3 |
| Pinkoi | `duplicate`: 2, `short_edge`: 3 |
| Shopee | None returned; rendered requests reached Shopee traffic-verification pages |
| MyShip | `short_edge`: 5 |
| Shopline | `short_edge`: 2, `byte_size`: 2 |
| 91App | `short_edge`: 12 |
| Cyberbiz | `aspect_ratio`: 5, `short_edge`: 7 |

Classifier rejects are represented by the difference between gate-passing and
classifier-kept counts; they are not image-gate rejection codes.

## Interpretation

Instagram, Pinkoi, MyShip, and Cyberbiz produced useful post-gate recovery.
Pinkoi moved from zero survivors to 54, and MyShip improved from 37 to 40 gate
survivors while removing generic chrome from the adapter result.

Shopee is inconclusive rather than a failed extractor: all rendered storefront
requests were redirected to traffic-verification pages, so the observation is
`render_blocked` under the rollout rules.

Shopline recovered six adapter images across four brands, but only two passed
the image gate and both were rejected by the classifier. The result meets the
five-image extraction-recovery threshold but does not demonstrate useful
end-to-end yield.

91App recovered twelve genuine product-card thumbnails from `74ounce`, but the
live CDN assets were only 200×300 and all failed the 480px gate. Clany rendered
successfully, but its homepage exposed category links rather than product
detail `SalePage/Index` cards, so it returned no adapter images. This is not a
render failure, and the cohort does not demonstrate useful end-to-end yield.

The old marketplace adapter combined its specialized selector with generic
gallery extraction and labeled the combined result with the adapter method.
Consequently, baseline Pinkoi, Shopee, and MyShip counts cannot separate old
selector hits from old generic fallback hits. The post-change numbers are
strict specialized-adapter output.

## Rollout gates

The staging sync initially reported the retired production-only `brands.mit_*`
columns as target drift. The sync now recognizes and omits those source-only
columns, allowing a scoped Clany sync without reintroducing removed staging
schema. Production migration history was repaired for the already-present
candidate table, and `20260826150000_product_origin_qualification.sql` was then
applied and verified, including its columns, trigger, indexes, and weekly cron.

Clany passed the staging end-to-end run with local rendering and no apply: 820
sitemap locations, 487 owned product routes, 20 complete triples, 20 usable
hydrations, five gate-ranked candidates, and five proposals. This run exposed
and repaired three additional defects before the production pilot: compressed
`.xml.gz` sitemap children were rejected, refresh candidate rows used the
submission ID instead of the live brand ID, and the 3,000-token response budget
truncated a 20-candidate structured response.

The production pilot ran against the documented ten-brand cohort after a full
rollback snapshot. No live brand was modified. Results were:

| Brand | Candidate rows | Gate survivors | Proposals |
|---|---:|---:|---:|
| `aisaniea` | 20 | 13 | 2 |
| `zenu` | 25 | 21 | 3 |
| `yun-clean` | 24 | 22 | 1 |
| `clany` | 25 | 20 | 4 |
| `boingboing` | 21 | 19 | 4 |
| `chih-tsui-fang` | 17 | 8 | 4 |
| `an-ma` | 3 | 1 | 0 |
| `memedo` | 6 | 6 | 0 |
| `man-man-soap` | 0 | 0 | 0 |
| `nsou` | 0 | 0 | 0 |

The discovery thresholds passed: Zenu produced 20 complete triples and 21 gate
survivors, Yun Clean produced more than two candidates, Boing Boing found 958
sitemap locations (near the known 956), and Clany found 487 owned routes. The
proposal counts sorted to `0, 0, 0, 0, 1, 2, 3, 4, 4, 4`, so the median was 1.5
against the required minimum of 3. The rollout therefore failed. All ten pilot
refreshes were rejected, the staging verification refresh was cleaned up,
nothing was published, and public Zenu verification was intentionally skipped.

## Repeatability

Run each post-change cohort with:

```sh
pnpm exec tsx scripts/image-eval/pipeline-ab.ts --adapter <adapter> --local-render
```

A future adapter must cover at least two affected brands, or one named launch
fixture; expose at least ten genuine items; have generic extraction below ten
usable items; and recover at least five items or reach ten on the same captured
HTML. `render_blocked` does not qualify as an extractor failure.
