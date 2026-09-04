# dev-1692
#
# @formoria-script
# purpose: DEV-1692 channel/budget proof — submit proof brands and run census on pending submissions
# class: operator
# invoke: pnpm exec tsx scripts/dev-1692/submit-proof-brands.ts
# target: staging-default
# safety: writes-on-apply
# owner: DEV-1692

Scripts for the DEV-1692 channel/budget evaluation proof artifact.

- `submit-proof-brands.ts` — submits the 9 proof brands (4 hub, 5 Instagram-only)
  via `submitBrandForReview` with service-role auth. Dry run by default; pass
  `--apply` to write. Idempotency key: `dev-1692:<slug>`.
- `proof-brands.json` — the 9 brands with their names and entry URLs.

Usage:

```sh
# Dry run — lists what would be submitted
pnpm exec tsx --env-file=.env.staging scripts/dev-1692/submit-proof-brands.ts

# Submit and write ids to a file
pnpm exec tsx --env-file=.env.staging scripts/dev-1692/submit-proof-brands.ts --apply --out ids.txt

# Census the resulting submissions (brand-census.ts extension)
pnpm exec tsx --env-file=.env.staging scripts/dev-1644/brand-census.ts \
  --submission-ids <id1>,<id2>,... --out docs/dev-1692/submission-census.json
```
