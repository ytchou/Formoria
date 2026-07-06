import { createClient as createSupabaseClient } from '@supabase/supabase-js'

type Source = 'enriched' | 'owner'

type BrandRow = Record<string, unknown> & {
  id: string
  slug: string
  brand_owners?: { user_id: string }[] | { user_id: string } | null
}

type FieldStateInsert = {
  brand_id: string
  field: string
  source: Source
  updated_by: string | null
}

type CliOptions = {
  dryRun: boolean
  batchSize: number
}

type FieldStateTable = {
  upsert: (
    rows: FieldStateInsert[],
    options: { onConflict: 'brand_id,field'; ignoreDuplicates: true },
  ) => Promise<{ error: { message?: string } | null }>
}

const BRAND_FIELDS = [
  'name',
  'slug',
  'description',
  'hero_image_url',
  'product_type',
  'contact_email',
  'city',
  'purchase_website',
  'purchase_pinkoi',
  'purchase_shopee',
  'social_instagram',
  'social_threads',
  'social_facebook',
  'other_urls',
  'retail_locations',
  'site_content',
  'status',
  'submitted_at',
  'approved_at',
  'founding_year',
  'price_range',
  'product_tags',
  'reputation_summary',
  'mit_status',
  'mit_verified_at',
  'mit_story',
  'mit_evidence',
  'source',
  'is_demo',
] as const

const SELECT_COLUMNS = `id, ${BRAND_FIELDS.join(', ')}, brand_owners(user_id)`

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  return createSupabaseClient(url, serviceRoleKey)
}

function parseArgs(argv: string[]): CliOptions {
  const dryRun = argv.includes('--dry-run')
  const batchSizeArg = argv.find((arg) => arg.startsWith('--batch-size='))
  const batchSize = batchSizeArg
    ? Number(batchSizeArg.slice('--batch-size='.length))
    : 500

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('--batch-size must be a positive integer')
  }

  return { dryRun, batchSize }
}

function isPopulated(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function firstOwnerId(brand: BrandRow): string | null {
  const owners = brand.brand_owners
  if (Array.isArray(owners))
    return owners.find((owner) => owner.user_id)?.user_id ?? null
  return owners?.user_id ?? null
}

function fieldStateTable(client: unknown): FieldStateTable {
  return (
    client as { from: (table: 'brand_field_state') => FieldStateTable }
  ).from('brand_field_state')
}

function buildRows(brand: BrandRow): FieldStateInsert[] {
  const ownerId = firstOwnerId(brand)
  const source: Source = ownerId ? 'owner' : 'enriched'

  return BRAND_FIELDS.filter((field) => isPopulated(brand[field])).map(
    (field) => ({
      brand_id: brand.id,
      field,
      source,
      updated_by: ownerId,
    }),
  )
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const supabase = createServiceClient()
  let offset = 0
  let scanned = 0
  let rowsBuilt = 0
  let rowsWritten = 0

  while (true) {
    const { data, error } = await supabase
      .from('brands')
      .select(SELECT_COLUMNS)
      .order('id', { ascending: true })
      .range(offset, offset + options.batchSize - 1)

    if (error) throw error

    const brands = (data ?? []) as unknown as BrandRow[]
    if (brands.length === 0) break

    scanned += brands.length
    const rows = brands.flatMap(buildRows)
    rowsBuilt += rows.length

    if (!options.dryRun && rows.length > 0) {
      const { error: upsertError } = await fieldStateTable(supabase).upsert(
        rows,
        {
          onConflict: 'brand_id,field',
          ignoreDuplicates: true,
        },
      )

      if (upsertError) throw upsertError
      rowsWritten += rows.length
    }

    console.log(
      `Progress: ${scanned} brand(s), ${rowsBuilt} field state row(s)`,
    )

    if (brands.length < options.batchSize) break
    offset += options.batchSize
  }

  console.log('\n--- Field State Backfill Summary ---')
  console.log(`Brands scanned: ${scanned}`)
  console.log(`Rows built: ${rowsBuilt}`)
  console.log(`Rows written: ${options.dryRun ? 0 : rowsWritten}`)
  if (options.dryRun) console.log('Dry run complete. No changes made.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
