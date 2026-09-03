# dev-1644
#
# @formoria-script
# purpose: DEV-1644 curation agent evaluation — render spike, cohort selection, before/after census, trace export
# class: operator
# invoke: pnpm exec tsx scripts/dev-1644/<script>.ts
# target: staging-default
# safety: read-only
# owner: DEV-1644

Scripts for evaluating the curation agents (DEV-1644).

Every file here is `class: operator`, `target: staging-default`, `safety: read-only`;
the header block above covers the directory, so no individual script repeats it.

- `social-render-spike.ts` — probes IG / Threads / Portaly to decide `socialBios` scope
- `select-cohort.ts` — read-only production census, quality scoring, bottom-quartile sample
- `export-traces.ts` — per-brand trace export for a curation job: outcome, turns,
  tokens, cost, renders, searches, wall clock, images and products, for all three agents
- `brand-census.ts` — field-level cohort snapshot (`--cohort … --out file.json`) and
  the before/after table (`--diff before.json after.json`) behind the proof artifact
