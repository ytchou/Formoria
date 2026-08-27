/**
 * DEV-1628 — backfill `brands.logo_storage_path` from existing brand_images.
 *
 * Finds active brand_images tagged `favicon` or `logo`, picks the best per
 * brand via `pickLogoImage`, and writes the winner's storage_path into the
 * brand row.
 *
 *   pnpm tsx scripts/backfill-logo-storage-path.ts              # dry run
 *   pnpm tsx scripts/backfill-logo-storage-path.ts --dry-run    # explicit dry run
 *   pnpm tsx scripts/backfill-logo-storage-path.ts --live       # writes to DB
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { pickLogoImage } from '@/lib/services/enrich-phases/favicon-download'

const PAGE_SIZE = 1_000

// ---------------------------------------------------------------------------
// IO layer
// ---------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createSupabaseClient>

function createServiceClient(): ServiceClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  }
  if (!serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY; this maintenance script requires a service role key'
    )
  }

  return createSupabaseClient(url, serviceRoleKey)
}

type BrandImageRow = {
  brand_id: string
  tags: string[] | null
  storage_path: string | null
}

/**
 * Fetches all active brand_images tagged `favicon` or `logo` that have a
 * storage_path set (otherwise there is nothing to propagate).
 */
async function fetchLogoImages(supabase: ServiceClient): Promise<BrandImageRow[]> {
  const rows: BrandImageRow[] = []
  let from = 0

  for (;;) {
    const { data, error } = await supabase
      .from('brand_images')
      .select('brand_id, tags, storage_path')
      .eq('status', 'active')
      .not('storage_path', 'is', null)
      .or('tags.cs.{favicon},tags.cs.{logo}')
      .order('brand_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to read brand_images: ${error.message}`)
    }

    const page = (data ?? []) as unknown as BrandImageRow[]
    rows.push(...page)

    if (page.length < PAGE_SIZE) {
      break
    }
    from += PAGE_SIZE
  }

  return rows
}

type BrandUpdate = {
  brandId: string
  logoStoragePath: string
}

/**
 * Groups image rows by brand_id, picks the best logo per brand, and returns
 * the planned updates.
 */
function planUpdates(imageRows: BrandImageRow[]): BrandUpdate[] {
  const byBrand = new Map<string, BrandImageRow[]>()
  for (const row of imageRows) {
    const existing = byBrand.get(row.brand_id)
    if (existing) {
      existing.push(row)
    } else {
      byBrand.set(row.brand_id, [row])
    }
  }

  const updates: BrandUpdate[] = []
  for (const [brandId, rows] of byBrand) {
    const path = pickLogoImage(rows)
    if (path) {
      updates.push({ brandId, logoStoragePath: path })
    }
  }

  return updates
}

/**
 * Applies updates to `brands.logo_storage_path`. Only writes when the column
 * is currently null — a concurrent writer wins, and re-runs are no-ops.
 */
async function applyUpdates(
  supabase: ServiceClient,
  updates: BrandUpdate[]
): Promise<number> {
  let written = 0

  for (const update of updates) {
    const { error, count } = await supabase
      .from('brands')
      .update({ logo_storage_path: update.logoStoragePath } as never)
      .eq('id', update.brandId)
      .is('logo_storage_path', null)

    if (error) {
      throw new Error(
        `Failed to update brands:${update.brandId}: ${error.message}`
      )
    }
    // count is available when head:true or count:'exact' is set, but we don't
    // need it for correctness — the is-null guard makes this idempotent.
    if (count !== null && count !== undefined) {
      written += count
    } else {
      written += 1
    }
  }

  return written
}

/**
 * Counts brands that still have no logo_storage_path after the backfill.
 */
async function countBrandsWithoutLogo(supabase: ServiceClient): Promise<number> {
  const { count, error } = await supabase
    .from('brands')
    .select('id', { count: 'exact', head: true })
    .is('logo_storage_path', null)

  if (error) {
    throw new Error(`Failed to count brands without logo: ${error.message}`)
  }

  return count ?? 0
}

async function run(live: boolean): Promise<void> {
  const supabase = createServiceClient()

  console.log(live ? 'Logo storage path backfill (LIVE)' : 'Logo storage path backfill (dry run)')
  console.log('')

  const imageRows = await fetchLogoImages(supabase)
  console.log(`Found ${imageRows.length} active brand_images tagged favicon or logo`)

  const updates = planUpdates(imageRows)
  console.log(`${updates.length} brands have a logo candidate`)

  if (live) {
    const written = await applyUpdates(supabase, updates)
    console.log(`Updated ${written} brands`)
  } else {
    for (const update of updates.slice(0, 10)) {
      console.log(`  would set brands:${update.brandId} → ${update.logoStoragePath}`)
    }
    if (updates.length > 10) {
      console.log(`  ... and ${updates.length - 10} more`)
    }
  }

  const remaining = await countBrandsWithoutLogo(supabase)

  console.log('')
  console.log('Summary:')
  console.log(`  Brands ${live ? 'updated' : 'would update'}: ${updates.length}`)
  console.log(`  Brands still without logo: ${remaining}`)

  if (!live) {
    console.log('')
    console.log('Dry run complete. Re-run with --live to write.')
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--dry-run')) {
    await run(false)
    return
  }

  if (args.includes('--live') && args.length === 1) {
    await run(true)
    return
  }

  throw new Error(
    'Usage: backfill-logo-storage-path.ts [--dry-run | --live] (dry run is the default)'
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
