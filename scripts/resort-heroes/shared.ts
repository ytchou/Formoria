import type {
  BrandImageForClassification,
  HeroResortPlan,
} from '@/lib/services/enrich-phases/classify-images'

export const PAGE = 1000
export const PREVIEW_PATH = 'scripts/resort-heroes/preview.json'
export const ARTIFACT_ROOT = `${process.env.HOME}/project/.artifact/formoria`

export type HeroSnapshot = {
  id: string
  url: string
  width: number | null
  height: number | null
  score: number | null
  tags: string[] | null
  focalX: number | null
  focalY: number | null
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

export type RestoreManifest = {
  generatedAt: string
  mode: 'live'
  brands: Array<{
    brandId: string
    images: Array<{ id: string; sort_order: number | null }>
    hero_image_url: string | null
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
    focalX: row.focal_x ?? null,
    focalY: row.focal_y ?? null,
  }
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
