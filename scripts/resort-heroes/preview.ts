import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { planHeroResort } from '@/lib/services/enrich-phases/classify-images'
import { createWriteBlockingClient } from '../lib/readonly-client'
import {
  PREVIEW_PATH,
  fingerprint,
  selectAllPages,
  snapshot,
  type ActiveRow,
  type PreviewBrand,
  type PreviewFile,
} from './shared'

type Brand = {
  id: string
  slug: string
  name: string
  hero_image_url: string | null
}

async function main(): Promise<void> {
  const { client, blocked } = createWriteBlockingClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  // PostgREST silently caps pages at 1000; stopping at the first short page would
  // make the reviewed plan incomplete and turn a rollback into data loss.
  const rows = await selectAllPages<ActiveRow>((from, to) =>
    client
      .from('brand_images')
      .select('*')
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, to),
  )
  const brands = await selectAllPages<Brand>((from, to) =>
    client
      .from('brands')
      .select('id, slug, name, hero_image_url')
      .order('id', { ascending: true })
      .range(from, to),
  )
  const brandById = new Map(brands.map((brand) => [brand.id, brand]))
  const grouped = new Map<string, ActiveRow[]>()
  for (const row of rows) {
    if (!row.brand_id) throw new Error(`active image ${row.id} has no brand_id`)
    const group = grouped.get(row.brand_id) ?? []
    group.push(row)
    grouped.set(row.brand_id, group)
  }

  const entries: PreviewBrand[] = []
  for (const [brandId, activeImages] of grouped) {
    const brand = brandById.get(brandId)
    if (!brand)
      throw new Error(`active images reference missing brand ${brandId}`)
    const plan = planHeroResort({ activeImages, mode: 'resort' })
    const byId = new Map(activeImages.map((row) => [row.id, row]))
    const currentSortOrders = activeImages
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({ id: row.id, sortOrder: row.sort_order ?? null }))
    const oldHeroRow = activeImages
      .filter((row) => typeof row.sort_order === 'number')
      .toSorted((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]
    const newHeroId =
      plan.assignments.find(({ sortOrder }) => sortOrder === 0)?.id ??
      activeImages.find((row) => row.sort_order === 0)?.id
    const newHeroRow = newHeroId ? byId.get(newHeroId) : undefined
    entries.push({
      brandId,
      slug: brand.slug,
      name: brand.name,
      heroImageUrl: brand.hero_image_url,
      fingerprint: fingerprint(activeImages),
      currentSortOrders,
      oldHero: oldHeroRow
        ? { ...snapshot(oldHeroRow), sortOrder: oldHeroRow.sort_order ?? null }
        : null,
      newHero: newHeroRow ? { ...snapshot(newHeroRow), sortOrder: 0 } : null,
      ranked: plan.ranked,
      rankedImages: plan.ranked.map(({ id }) => {
        const row = byId.get(id)
        if (!row)
          throw new Error(`ranked image ${id} missing from brand ${brandId}`)
        return { ...snapshot(row), id }
      }),
      assignments: plan.assignments,
      demotedIds: plan.demotedIds,
      skipReason: plan.skipReason,
    })
  }

  const output: PreviewFile = {
    generatedAt: new Date().toISOString(),
    brands: entries,
  }
  // Assert before writing, never after: a preview that attempted a blocked write
  // is uncertified, and leaving its preview.json on disk lets an operator feed it
  // straight into apply. The artifact must not exist unless this passes.
  if (blocked.length > 0) {
    // The planner is pure and preview never needs a write. Any blocked call proves
    // a transitive import escaped the preview boundary and must fail the run.
    throw new Error(`preview attempted ${blocked.length} blocked write(s)`)
  }
  await mkdir(dirname(PREVIEW_PATH), { recursive: true })
  await writeFile(PREVIEW_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(
    `wrote ${PREVIEW_PATH} (${entries.length} brands, ${rows.length} active rows)`,
  )
}

void main().catch((error: unknown) => {
  console.error(
    '\nFAILED:',
    error instanceof Error ? error.message : JSON.stringify(error),
  )
  process.exitCode = 1
})

export {}
