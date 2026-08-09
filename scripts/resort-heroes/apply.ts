import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { syncHeroDenormalized } from '@/lib/services/brand-images'
import { MAX_BRAND_ACTIVE_SORT_ORDER } from '@/lib/constants/brand-images'
import { createServiceClient } from '@/lib/supabase/service'
import {
  PREVIEW_PATH,
  fingerprint,
  selectAllPages,
  type ActiveRow,
  type PreviewFile,
  type RestoreManifest,
} from './shared'

const MANIFEST_DIR = 'scripts/resort-heroes/manifests'
const COMPLETED_PATH = 'scripts/resort-heroes/completed.jsonl'

// Every argument is validated before the flag is honoured: a typo'd flag next to
// `--live` must fail loudly, not be silently ignored on a run that mutates 844
// brands.
function liveOnly(): boolean {
  const args = process.argv.slice(2)
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

async function loadActiveRows(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string,
): Promise<ActiveRow[]> {
  return selectAllPages<ActiveRow>((from, to) =>
    supabase
      .from('brand_images')
      .select('*')
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, to),
  )
}

async function main(): Promise<void> {
  const preview = JSON.parse(
    await readFile(PREVIEW_PATH, 'utf8'),
  ) as PreviewFile
  if (!liveOnly()) {
    console.log(
      `dry run: ${preview.brands.length} reviewed brand(s); no changes made`,
    )
    return
  }
  const supabase = createServiceClient()
  const current = new Map<string, ActiveRow[]>()
  const eligible: typeof preview.brands = []
  for (const entry of preview.brands) {
    const rows = await loadActiveRows(supabase, entry.brandId)
    current.set(entry.brandId, rows)
    if (fingerprint(rows) !== entry.fingerprint) {
      console.error(`[SKIP] ${entry.slug}: fingerprint changed since preview`)
      continue
    }
    eligible.push(entry)
  }

  const manifest: RestoreManifest = {
    generatedAt: new Date().toISOString(),
    mode: 'live',
    brands: [...current].map(([brandId, rows]) => ({
      brandId,
      images: rows.map((row) => ({
        id: row.id,
        sort_order: row.sort_order ?? null,
      })),
      hero_image_url:
        preview.brands.find((entry) => entry.brandId === brandId)
          ?.heroImageUrl ?? null,
    })),
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const manifestPath = resolve(MANIFEST_DIR, `resort-heroes-live-${stamp}.json`)
  // The manifest is flushed before the first mutation; a stale backup is safer
  // than a crash after mutation with no lossless restore record.
  await flushedWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`restore manifest: ${manifestPath}`)

  for (const entry of eligible) {
    if (entry.skipReason !== null) continue
    if (entry.demotedIds.length > 0) {
      throw new Error(
        `invariant violation for ${entry.slug}: non-empty demotedIds`,
      )
    }
    const rows = current.get(entry.brandId) ?? []
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
      rows.filter((row) => !['owner', 'admin'].includes(row.source ?? ''))
        .length
    ) {
      throw new Error(
        `invariant violation for ${entry.slug}: incomplete ordering assignment`,
      )
    }
    const changed = entry.assignments.filter(
      ({ id, sortOrder }) => byId.get(id) !== sortOrder,
    )
    if (changed.length === 0) continue
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
    console.log(`[OK] ${entry.slug}`)
  }
}

void main().catch((error: unknown) => {
  console.error(
    '\nFAILED:',
    error instanceof Error ? error.message : JSON.stringify(error),
  )
  process.exitCode = 1
})

export {}
