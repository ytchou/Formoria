/**
 * A cohort is the set of brands one snapshot/refresh/render cycle operates on.
 *
 * Every cohort is JSON in `scripts/curation-cohorts/` and is selected with
 * `--cohort <name-or-path>`. No cohort is special-cased in code: the expo-15
 * shortlist was the first cohort and is still the default when `--cohort` is
 * absent, but it is loaded from `expo15.json` like any other.
 *
 * Slugs come from the JSON's `labels` keys rather than a separate array: one
 * source of truth means a brand can never be refreshed but missing from the
 * comparison page, which is the failure mode that actually hurts — you mutate
 * production and then cannot see what you did.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const COHORT_ROOT = 'scripts/curation-cohorts'

/** The cohort that runs when no `--cohort` flag is passed. */
const DEFAULT_COHORT = 'expo15'

/** Snapshots, refresh logs, and rollback copies live under here, one dir per cohort. */
const SNAPSHOT_ROOT = 'scripts/curation-rerun/snapshots'

export type Cohort = {
  name: string
  title: string
  subtitle: string
  slugs: string[]
  labels: Record<string, string>
  /** Optional cohort-specific caveat, rendered as a warning callout on the comparison page. */
  warning?: string
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv.at(index + 1)
}

/** `--cohort <name>` resolves to `scripts/curation-cohorts/<name>.json`; a path with a slash is used as-is. */
export async function loadCohort(): Promise<Cohort> {
  const ref = argValue('--cohort') ?? DEFAULT_COHORT

  const path = ref.includes('/') ? resolve(ref) : resolve(COHORT_ROOT, `${ref}.json`)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new Error(`cohort not found: ${path}`)
  }

  const parsed = JSON.parse(raw) as Partial<Cohort>
  const labels = parsed.labels ?? {}
  const slugs = Object.keys(labels)
  if (slugs.length === 0) throw new Error(`cohort ${path} has no labels/slugs`)

  return {
    name: parsed.name ?? ref,
    title: parsed.title ?? `${ref} — production refresh, before / after`,
    subtitle: parsed.subtitle ?? '',
    slugs,
    labels,
    ...(parsed.warning ? { warning: parsed.warning } : {}),
  }
}

/**
 * Per-cohort snapshot/log directory, so cohorts never overwrite each other's
 * rollback copies.
 *
 * `expo15` is the exception: it predates the per-cohort layout and its
 * `before.json`/`after.json` sit loose in the snapshots root. Re-homing them
 * would orphan an existing rollback copy, so the bare path is kept for that one
 * name. This is a data-location quirk carried over from the original run, not a
 * behavioural special case.
 */
export function snapshotDir(cohort: Cohort): string {
  return cohort.name === DEFAULT_COHORT ? SNAPSHOT_ROOT : `${SNAPSHOT_ROOT}/${cohort.name}`
}
