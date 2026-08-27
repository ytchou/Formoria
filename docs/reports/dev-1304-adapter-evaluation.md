# DEV-1304 adapter evaluation

## Status

Live baseline and post-change measurements were not run on 2026-08-27 because no safe non-production evaluation environment was provisioned in the linked worktree. No evaluation calls were made and no submissions, images, or brands were created.

The repeatable evaluator now uses the production image gates, perceptual-duplicate predicate, classifier batch/profile, audited OpenAI client boundary, and audited Serper image-search boundary. It fails when any requested cohort slug is missing.

## Cohorts and measurements

| Adapter | Brands | Baseline | Post-change |
|---|---|---:|---:|
| Instagram | `seeseamylove`, `yarn-ball`, `memedo`, `quoin`, `tings-aroma` | Not run | Not run |
| Pinkoi | `seeseamylove`, `memedo`, `guaguaforest`, `tings-aroma`, `zenu` | Not run | Not run |
| Shopee | `yun-clean`, `man-man-soap`, `nsou`, `yi-fan-canvas-bags`, `my-beast` | Not run | Not run |
| MyShip | `an-ma`, `billnogates`, `lumirona`, `honestea`, `scent-forest` | Not run | Not run |
| Shopline | `zenu`, `satana`, `addable`, `inblooom`, `goodglas` | Not run | Not run |
| 91App | `clany`, `74ounce`, `a-mour`, `solis`, `erss` | Not run | Not run |
| Cyberbiz | `chih-tsui-fang`, `fluffystar`, `糖果屋幼教用品社`, `anta-pottery`, `buwu` | Not run | Not run |

Each live row must record returned images, production-gate survivors, classifier keeps, and rejection-code counts. Required formulas are catalog completeness = complete triples / owned detail URLs; image gate pass = gate survivors / unique adapter images; classifier keep = kept / gate survivors; end-to-end image yield = kept / unique adapter images; proposal yield = proposals / gate-surviving candidates.

## Qualification and next command

A future adapter must cover at least two affected brands, or one named launch fixture; expose at least ten genuine items; have generic extraction below ten usable items; and recover at least five items or reach ten on the same captured HTML. `render_blocked` does not qualify as an extractor failure.

After provisioning a safe non-production `.env.local`, run `make doctor`, then run `pnpm exec tsx --env-file=.env.local scripts/image-eval/pipeline-ab.ts --adapter <adapter> --local-render` once for each cohort. Replace every “Not run” value with the resulting metrics before rollout.
