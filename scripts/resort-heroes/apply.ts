import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { syncHeroDenormalized } from '@/lib/services/brand-images'
import { MAX_BRAND_ACTIVE_SORT_ORDER } from '@/lib/constants/brand-images'
import { isExemptSource } from '@/lib/services/enrich-phases/classify-images'
import { createServiceClient } from '@/lib/supabase/service'
import {
  COMPLETED_PATH,
  MANIFEST_DIR,
  PREVIEW_PATH,
  fingerprint,
  loadActiveRows,
  type ActiveRow,
  type PreviewFile,
  type RestoreManifest,
} from './shared'
import { loadScriptTarget } from '../shared/target'

/**
 * Recovery from a failed or unwanted apply is `pnpm resort-heroes:rollback
 * --manifest <path>`, not a re-run. `completed.jsonl` is an operator progress
 * log; no script reads it. A re-run is *safe* (each brand's fingerprint is
 * re-checked immediately before its writes, so already-mutated brands skip),
 * but it writes a second manifest covering only the brands it touched — so a
 * full restore after an abort-then-re-run must replay every manifest, newest
 * first. Ceiling: if aborts become routine, make rollback accept several
 * manifests and order them itself rather than teaching apply to resume.
 */

// Every argument is validated before the flag is honoured: a typo'd flag next to
// `--live` must fail loudly, not be silently ignored on a run that mutates 844
// brands.
function liveOnly(args: readonly string[]): boolean {
  const unknown = args.filter((arg) => arg !== '--live')
  if (unknown.length > 0) {
    throw new Error(`unknown argument(s): ${unknown.join(' ')}`)
  }
  return args.includes('--live')
}

async function flushedWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const file = await open(path, 'w')
  try {
    await file.writeFile(content, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
}

async function appendFlushed(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const file = await open(path, 'a')
  try {
    await file.writeFile(content, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
}

// Module-scoped so the failure handler can still tell the operator where the
// restore record is: an abort mid-loop is exactly when that path matters most.
let activeManifestPath: string | null = null

async function main(): Promise<void> {
  const { argv } = loadScriptTarget()
  const preview = JSON.parse(
    await readFile(PREVIEW_PATH, 'utf8'),
  ) as PreviewFile
  if (!liveOnly(argv)) {
    console.log(
      `dry run: ${preview.brands.length} reviewed brand(s); no changes made`,
    )
    return
  }
  const supabase = createServiceClient()

  // Pass 1 is a fail-fast pre-check only: it reports how far the database has
  // already drifted from the reviewed plan before anything is mutated. It is NOT
  // the authority for any write — its reads are minutes old by the time the last
  // brand is written, so pass 2 re-reads and re-fingerprints each brand
  // immediately before that brand's own updates. Its skips are logged as
  // [PRECHECK SKIP]; the authoritative ones in pass 2 are logged as [SKIP], and
  // a brand can legitimately appear in one and not the other.
  const candidates: typeof preview.brands = []
  for (const entry of preview.brands) {
    const rows = await loadActiveRows(supabase, entry.brandId)
    if (fingerprint(rows) !== entry.fingerprint) {
      console.error(
        `[PRECHECK SKIP] ${entry.slug}: fingerprint changed since preview`,
      )
      continue
    }
    candidates.push(entry)
  }
  console.log(
    `precheck: ${candidates.length}/${preview.brands.length} brand(s) still match the reviewed preview`,
  )

  // The manifest is created and flushed before the first mutation, then extended
  // and re-flushed with each brand's freshly-read pre-write ordering *before*
  // that brand is touched. Recording the fresh read rather than the pre-check
  // snapshot is what makes a rollback restore what apply actually overwrote.
  const manifest: RestoreManifest = {
    generatedAt: new Date().toISOString(),
    mode: 'live',
    brands: [],
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const manifestPath = resolve(MANIFEST_DIR, `resort-heroes-live-${stamp}.json`)
  activeManifestPath = manifestPath
  const writeManifest = async (): Promise<void> => {
    await flushedWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  await writeManifest()
  console.log(
    `\n=== RESTORE MANIFEST ===\n${manifestPath}\nThis file is the only rollback path for this run. Copy it somewhere safe.\n`,
  )

  let mutated = 0
  for (const entry of candidates) {
    if (entry.skipReason !== null) continue
    if (entry.demotedIds.length > 0) {
      throw new Error(
        `invariant violation for ${entry.slug}: non-empty demotedIds`,
      )
    }
    // Authoritative read: issued immediately before this brand's writes, so the
    // window in which a curation job or an admin re-order can slip between the
    // check and the update is one round trip rather than the whole run.
    const rows: ActiveRow[] = await loadActiveRows(supabase, entry.brandId)
    if (fingerprint(rows) !== entry.fingerprint) {
      console.error(`[SKIP] ${entry.slug}: fingerprint changed since preview`)
      continue
    }
    const byId = new Map(rows.map((row) => [row.id, row.sort_order ?? null]))
    if (
      entry.assignments.some(
        ({ sortOrder }) =>
          sortOrder < 0 || sortOrder > MAX_BRAND_ACTIVE_SORT_ORDER,
      )
    ) {
      throw new Error(
        `invariant violation for ${entry.slug}: assignment outside active range`,
      )
    }
    if (
      new Set(entry.assignments.map(({ sortOrder }) => sortOrder)).size !==
      entry.assignments.length
    ) {
      throw new Error(
        `invariant violation for ${entry.slug}: duplicate assignment sort_order`,
      )
    }
    // A resort must never demote or reject; the preview schema has no demoted set,
    // so an assignment set that omits a managed active row is an invariant failure.
    if (
      entry.assignments.length !==
      rows.filter((row) => !isExemptSource(row.source)).length
    ) {
      throw new Error(
        `invariant violation for ${entry.slug}: incomplete ordering assignment`,
      )
    }
    const changed = entry.assignments.filter(
      ({ id, sortOrder }) => byId.get(id) !== sortOrder,
    )
    if (changed.length === 0) continue

    manifest.brands.push({
      brandId: entry.brandId,
      images: rows.map((row) => ({
        id: row.id,
        sort_order: row.sort_order ?? null,
      })),
    })
    await writeManifest()

    // Descending targets minimise duplicate sort_order values during a crash
    // window when the database has no unique (brand_id, sort_order) index.
    for (const { id, sortOrder } of changed.toSorted(
      (a, b) => b.sortOrder - a.sortOrder,
    )) {
      const { error } = await supabase
        .from('brand_images')
        .update({ sort_order: sortOrder })
        .eq('id', id)
      if (error) {
        // This is an invariant failure, not a transient batch error: continuing
        // would leave later brands with an unreviewed, partially corrupt run.
        // Everything mutated so far is in the manifest; recover with rollback.
        throw new Error(
          `failed to update ${entry.slug}/${id}: ${error.message}`,
        )
      }
    }
    await syncHeroDenormalized(supabase, entry.brandId)
    await appendFlushed(
      COMPLETED_PATH,
      `${JSON.stringify({ brandId: entry.brandId, slug: entry.slug, completedAt: new Date().toISOString() })}\n`,
    )
    mutated += 1
    console.log(`[OK] ${entry.slug}`)
  }

  console.log(
    `\n=== RESTORE MANIFEST ===\n${manifestPath}\n${mutated} brand(s) mutated. Roll back with:\n  pnpm resort-heroes:rollback -- --manifest ${manifestPath}\n`,
  )
}

void main().catch((error: unknown) => {
  console.error(
    '\nFAILED:',
    error instanceof Error ? error.message : JSON.stringify(error),
  )
  if (activeManifestPath !== null) {
    console.error(
      `\n=== RESTORE MANIFEST ===\n${activeManifestPath}\nEvery brand mutated before the failure is recorded there. Roll back with:\n  pnpm resort-heroes:rollback -- --manifest ${activeManifestPath}\n`,
    )
  }
  process.exitCode = 1
})

export {}
