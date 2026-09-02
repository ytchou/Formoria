# dev-1644
#
# @formoria-script
# purpose: DEV-1644 acquisition agent evaluation — render spike, cohort census, trace export
# class: operator
# invoke: pnpm exec tsx scripts/dev-1644/<script>.ts
# target: staging-default
# safety: read-only
# owner: DEV-1644

Scripts for evaluating the acquisition agent (DEV-1644 PR 1):

- `social-render-spike.ts` — probes IG / Threads / Portaly to decide `socialBios` scope
- `select-cohort.ts` — read-only production census, quality scoring, bottom-quartile sample
- `export-traces.ts` — per-brand trace export for a curation job
