# scripts/shared/

# @formoria-script
# purpose: Shared runtime helpers for operator scripts; nothing here is run directly.
# class: shared
# invoke: not invoked directly; imported by scripts under scripts/
# target: none
# safety: read-only
# owner: engineering

| module | what it is |
|---|---|
| `target.ts` | `loadScriptTarget()` — resolves `--target`, loads `.env.staging` (default) or `.env.local` (`--target production`), proves the credentials name that project, and returns the argv with the flag stripped |
| `environment.ts` | required-env-var reader for the scheduled automations |
| `artifact.ts` | resolves the output path for a script's generated artifact |
| `langfuse-paced-write.ts` | `pacedLangfuseWriter()` — paced, 429-retrying Langfuse calls and id-confirmed dataset-item writes (the SDK resolves a 429 as success); shared by `llm-eval` and `harvest-name-arbiter-golden` |

Every operator script calls `loadScriptTarget()` as the first statement of its
`main()`, so the safe default is always the disposable database.

This directory is represented in the registry by this README alone: its
contents are exempt from the one-header-per-file rule.
