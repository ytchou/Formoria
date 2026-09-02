# curation-rerun

Re-runs the production curation pipeline over a named set of live brands, and
renders a before/after comparison of what it changed.

This tool reimplements nothing. It calls the same service functions the admin UI
calls, in the same order:

1. `request_brand_refresh` — snapshots each brand into a pending refresh
   submission (`intent='refresh'`, `brand_id` set).
2. a real curation job — `enqueueAdminCurationJob` → `runJob` → `runEnrich`.
3. `apply_brand_refresh` — writes the enriched result back onto the brand and
   retires replaced images.

Step 2 must be a job, not a bare `runEnrich`. `apply_brand_refresh` reads the
latest `curation_job_targets` row for the submission and refuses to apply unless
it is `succeeded`; a direct `runEnrich` enriches the submission correctly but
records no target row, so every apply fails with "Refresh must have a successful
enrichment run before apply".

## Files

| File | Purpose |
| --- | --- |
| `cohort.ts` | Loads a cohort JSON and resolves its snapshot directory. |
| `snapshot.ts` | Read-only full snapshot of a cohort's brands + child rows. |
| `refresh.ts` | The three-step refresh itself. Mutates production. |
| `render.ts` | Renders the before/after HTML artifact from two snapshots. |
| `snapshots/` | Snapshots, refresh logs, rollback copies. Gitignored. |

## Cohorts

A cohort is a JSON file in `scripts/curation-cohorts/<name>.json`, selected with
`--cohort <name>`. A path containing a slash is used as-is instead. With no
`--cohort` flag the default is `expo15`.

Slugs are the keys of `labels` — there is no separate slug array, so a brand can
never be refreshed but missing from the comparison page.

```json
{
  "name": "recuration-pilot-1",
  "title": "Re-curation pilot 1 — batch 1 sample",
  "subtitle": "Five brands drawn from the approved brands with brand_enriched_at IS NULL.",
  "warning": "Optional. Rendered as a warning callout on the comparison page. Plain text.",
  "labels": {
    "point-chen": "點點陳 Point Chen",
    "one-wood": "One Wood"
  }
}
```

`name` determines the snapshot directory, so it should match the filename.
`warning` is optional; every other field is required.

## Workflow

Every command below defaults to staging. Add `--target production` to run
against production; the script prints the project ref it resolved before it
touches anything, and warns when production is driven from a branch other than
`main`.

```bash
# 1. Snapshot production BEFORE touching anything.
pnpm exec tsx scripts/curation-rerun/snapshot.ts \
  --cohort batch1-never-curated --target production --out before.json

# 2. Dry run. Creates nothing; prints how many refresh submissions exist and
#    how many would be created.
pnpm exec tsx scripts/curation-rerun/refresh.ts \
  --cohort batch1-never-curated --target production --dry-run

# 3. The real run. Requires --confirm.
pnpm exec tsx scripts/curation-rerun/refresh.ts \
  --cohort batch1-never-curated --target production --confirm

# 4. Snapshot production AFTER.
pnpm exec tsx scripts/curation-rerun/snapshot.ts \
  --cohort batch1-never-curated --target production --out after.json

# 5. Render the comparison artifact.
pnpm exec tsx scripts/curation-rerun/render.ts \
  --cohort batch1-never-curated --target production
```

The `pnpm` script aliases are equivalent:

```bash
pnpm curation:snapshot --cohort batch1-never-curated --out before.json
pnpm curation:rerun    --cohort batch1-never-curated --dry-run
pnpm curation:render   --cohort batch1-never-curated
```

### Flags

- `--cohort <name|path>` — which cohort to operate on. Default `expo15`.
- `--dry-run` / `--confirm` (`refresh.ts`) — one is required. Without either,
  the script refuses to run.
- `--slugs a,b` (`refresh.ts`) — re-run a subset of the cohort. Each slug must
  already be in the cohort.
- `--via-worker` (`refresh.ts`) — see below.
- `--out <file>` (`snapshot.ts`) — filename inside the cohort's snapshot dir.
- `--before <file>` / `--after <file>` (`render.ts`) — override the default
  `before.json` / `after.json`.

## `--via-worker` vs in-process

In-process is the **default**: this checkout claims the job and calls `runJob`
itself, so the pipeline that executes is the code in your working tree. That is
what you want when validating a pipeline change.

`--via-worker` instead calls `dispatchCurationJob(job.id)` to hand the job to the
deployed Railway curation worker, then polls the job row every 15s — printing
succeeded/failed/skipped/total target counts each poll — until the job reaches
`completed`, `failed`, or `cancelled`. It gives up after 6 hours with an error
that names the job id; the job keeps running server-side after that, so do not
re-enqueue.

The catch: the worker runs whatever SHA it happens to have deployed, which is
not necessarily your branch. The curation-worker service has no GitHub source
connected (DEV-1260; see `Dockerfile.curation-worker`), so builds are pushed by
hand with `railway up` and "what is deployed" cannot be inferred from git.

Both paths call the same `runJob`. The only differences are which copy of it runs
and whether your machine has to stay awake for the duration.

`--via-worker` requires `CURATION_WORKER_URL` and
`CURATION_WORKER_CONTROL_TOKEN`.

## The before-snapshot is the only rollback copy

There is no undo. `apply_brand_refresh` overwrites live brand columns and retires
replaced images; nothing else in the system holds the previous values.
`before.json` from step 1 is the entire rollback story, which is why:

- `snapshot.ts` uses `select('*')` — a column added later lands in the backup
  without anyone remembering to update a field list.
- It captures child rows (`brand_images`, `brand_faq`, `brand_channels`) too;
  restoring only `brands` would leave the brand pointing at images that no
  longer exist.
- It pages to exhaustion. PostgREST caps a response at 1000 rows and reports the
  cap as an ordinary short result, so a single unpaged `select('*')` silently
  truncated a 1078-row `brand_images` backup at 1000.
- It refuses to overwrite an existing output file. If `--out` collides, pass a
  different name rather than deleting the old one.
- It hard-fails if fewer brands are found than the cohort names, because a
  partial "before" is a partial rollback.

Take the before-snapshot, confirm it is complete, and only then run the refresh.
