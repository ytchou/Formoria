# scripts/

This file documents the convention. It is **not** a catalog — run
`pnpm scripts:list` for the current list of scripts, which is generated from the
header blocks themselves and therefore cannot drift.

## Header block

Every script carries a header block as its first comment. `pnpm scripts:list`
reads it, and `pnpm check:script-registry` (part of `pnpm lint`) fails without it.

```
/**
 * @formoria-script
 * purpose: one line stating what this script does
 * class: ci-gate | generator | operator | validator | deploy-tool | scheduled-automation | shared | parked
 * invoke: pnpm <alias>
 * target: staging-default | none | ci
 * safety: read-only | dry-run-default | writes-on-apply | writes
 * owner: <team or person>
 * prerequisites: optional
 * notes: optional
 */
```

Comment leaders vary by file type: `*` in `.ts`, `.mjs` and `.js`; `#` in `.sh`,
`.py` and in a directory's `README.md`; `--` in `.sql`. The keys are identical.

`purpose`, `class`, `invoke`, `target`, `safety` and `owner` are required.
`prerequisites` and `notes` are optional.

- **target** — `staging-default` (loads `.env.staging`; production needs an
  explicit `--target production`), `none` (touches no database), `ci` (runs in
  CI only).
- **safety** — `read-only`, `dry-run-default` (writes only with `--apply`),
  `writes-on-apply` (same, but the write is destructive), `writes` (writes on
  every run).

## Classes

| class | what it is |
|---|---|
| `ci-gate` | runs in `pnpm lint` or CI and fails the build |
| `generator` | produces a checked-in artifact from a source of truth |
| `validator` | reports drift or defects; never fixes them |
| `operator` | a human runs it against a real project |
| `deploy-tool` | part of a deploy or migration path |
| `scheduled-automation` | a workflow or cron job runs it unattended |
| `shared` | library code imported by other scripts; not run directly |
| `parked` | kept deliberately, not wired to anything today |

## How to add a script

1. Put it in `scripts/`. A multi-file tool gets its own subdirectory with
   exactly one entry file carrying the header block; the rest of the directory
   needs none.
2. Add the header block as the first comment.
3. Add a package.json alias and name it in `invoke`. The gate fails when
   `invoke` names an alias that does not exist, and when an alias points at a
   file that does not exist.
4. Operator scripts call `loadScriptTarget()` first, so they default to staging.
5. Run `pnpm check:script-registry` and `pnpm scripts:list`.

## How to retire a script

Retirement is deletion. The history is the archive.

1. Prove the script has no remaining work — a read-only count against
   production, recorded in the PR body. A nonzero count means it stays.
2. Tag the commit before the deletion: `git tag scripts-retired/<YYYY-MM-DD>`
   and push the tag. That tag is how the file is recovered
   (`git show <tag>:scripts/<name>`).
3. Delete the script, its tests, and its package.json alias.
4. Add one row to the Retired table below.
5. Sweep for danglers: `rg -n "<name>" package.json .github src scripts`.

## Retired

| name | ticket | tag | date |
|---|---|---|---|
| `scripts/apply-audit-corrections.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/apply-description-edits.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/apply-refresh-submissions.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/backfill-brand-image-alt-zh.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/backfill-brand-image-alt-zh.test.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/backfill-brand-images.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/backfill-faq-entries.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/backfill-subcategory-slugs.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/cleanup-pending-edits.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/clear-contaminated-links.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/clear-dev-1309-websites.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/link-cleanup/run.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/migrate-staging-to-free-org.sh` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/rehearse-slug-reverse.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/__tests__/rehearse-slug-reverse.test.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/slug-reverse-corpus.json` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/run-refresh-enrichment.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/seed-expansion-data.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/seed-expo-exhibitor-content.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |
| `scripts/tmp-recuration-monitor.ts` | DEV-1318 | `scripts-retired/2026-09-02` | 2026-09-02 |

`scripts/slug-reverse-corpus.json` is retired from `scripts/` but not deleted:
the 2,446-string pre-migration corpus is evidence, and
`src/lib/services/__tests__/material-corrections.test.ts` asserts against it, so
it moved to `src/lib/services/__tests__/fixtures/slug-reverse-corpus.json`.

The nine `scripts/health-audit-2026-*.sql` snapshots carry no row: they were
already deleted in `546107846`, before this ticket and before the tag, so
`scripts-retired/2026-09-02` is not where they are recovered from.

