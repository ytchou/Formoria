import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BrandImageForClassification,
  HeroResortPlan,
} from '@/lib/services/enrich-phases/classify-images'
import { createServiceClient } from '@/lib/supabase/service'
import { ARTIFACT_ROOT } from '../shared/artifact'

export const PAGE = 1000

// Every generated path is anchored to the repo root, never `process.cwd()`:
// running `pnpm resort-heroes:apply -- --live` from a subdirectory used to write
// the preview and the restore manifest somewhere else entirely, which is the one
// file an operator needs after a bad run. Matches scripts/check-*.mjs, which
// resolve their ROOT from `import.meta.url` for the same reason.
export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
export const PREVIEW_PATH = resolve(
  REPO_ROOT,
  'scripts/resort-heroes/preview.json',
)
export const COMPLETED_PATH = resolve(
  REPO_ROOT,
  'scripts/resort-heroes/completed.jsonl',
)
// Restore manifests live beside the review artifact, outside the repo: they are
// the only rollback path for ~844 mutated brands, and inside the repo they were
// gitignored — one `git clean -xdf` between apply and the rollback decision
// destroyed them along with preview.json.
export const MANIFEST_DIR = resolve(ARTIFACT_ROOT, 'resort-heroes-manifests')

export type HeroSnapshot = {
  id: string
  url: string
  width: number | null
  height: number | null
  score: number | null
  tags: string[] | null
}

export type PreviewBrand = {
  brandId: string
  slug: string
  name: string
  heroImageUrl: string | null
  fingerprint: string
  currentSortOrders: Array<{ id: string; sortOrder: number | null }>
  oldHero: (HeroSnapshot & { sortOrder: number | null }) | null
  newHero: (HeroSnapshot & { sortOrder: number }) | null
  ranked: HeroResortPlan['ranked']
  rankedImages: Array<HeroSnapshot & { id: string }>
  assignments: HeroResortPlan['assignments']
  demotedIds: string[]
  skipReason: HeroResortPlan['skipReason']
}

export type PreviewFile = {
  generatedAt: string
  brands: PreviewBrand[]
}

// No `hero_image_url`: rollback restores per-image sort_order and then calls
// syncHeroDenormalized, which recomputes the hero from the restored ordering. A
// recorded URL was never read, and the one that used to be written came from the
// preview snapshot rather than the row apply actually overwrote — a stale value
// that would mislead anyone reading the manifest during an incident.
export type RestoreManifest = {
  generatedAt: string
  mode: 'live'
  brands: Array<{
    brandId: string
    images: Array<{ id: string; sort_order: number | null }>
  }>
}

export type ActiveRow = BrandImageForClassification & { brand_id: string }

export function fingerprint(
  rows: Array<{ id: string; sort_order?: number | null }>,
): string {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => [row.id, row.sort_order ?? null]),
  )
}

export function snapshot(row: BrandImageForClassification): HeroSnapshot {
  return {
    id: row.id,
    url: row.url,
    width: row.width ?? null,
    height: row.height ?? null,
    score:
      typeof row.score === 'number'
        ? row.score
        : row.score === null
          ? null
          : Number(row.score),
    tags: row.tags ?? null,
  }
}

/**
 * One brand's active rows. Shared by apply and rollback, which both need a read
 * issued immediately before that brand's own writes — apply so the fingerprint
 * it checks describes the rows it is about to overwrite, rollback so the
 * membership guard does. Do not lift this into a single bulk read: the point of
 * the per-brand call is that nothing else happens between it and the update.
 */
export async function loadActiveRows(
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

export async function selectAllPages<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) throw error
    const page = data ?? []
    all.push(...page)
    if (page.length < PAGE) return all
  }
}
