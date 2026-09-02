# scripts/hooks/

# @formoria-script
# purpose: Git hooks installed by `pnpm prepare` via core.hooksPath.
# class: ci-gate
# invoke: bash scripts/hooks/pre-commit
# target: none
# safety: read-only
# owner: engineering
# notes: this README is the directory's registry entry because `pre-commit` has no file extension and the gate walks by extension

`pre-commit` blocks a direct commit to `main` or `master` and runs
`scripts/check-favicon-rgba.mjs`, which is the guard for the failure mode that
breaks a Railway production build silently.

`pnpm prepare` points `core.hooksPath` at this directory, so a fresh clone picks
the hooks up on install.
