import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { localizeToTW } from '../src/lib/services/taiwan-localization'

const FAQ_COLUMNS = [
  'faq_mit',
  'faq_where_to_buy',
  'faq_products',
  'faq_price',
  'faq_founded',
  'faq_reputation',
  'faq_custom_1',
  'faq_custom_2',
  'faq_custom_3',
  'faq_custom_4',
] as const

const BATCH_SIZE = 10

type CliOptions = {
  dryRun: boolean
}

type BrandRow = {
  id: string
  name: string | null
  description: string | null
  blurb: string | null
  reputation_summary: unknown
}

type FaqRow = {
  brand_id: string
  [key: string]: unknown
}

type ImageRow = {
  id: string
  alt_zh: string | null
}

type FaqValue = Record<string, unknown>

type BackfillCounts = {
  updated: number
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createSupabaseClient(url, serviceRoleKey)
}

function parseArgs(argv: string[]): CliOptions {
  return { dryRun: argv.includes('--dry-run') }
}

function localizeString(value: unknown, brandName?: string): { value: string; changed: boolean } | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const localized = localizeToTW(value, brandName ? { brandName } : undefined).text
  return { value: localized, changed: localized !== value }
}

function localizeReputationSummary(value: unknown, brandName?: string): { value: unknown; changed: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false }
  const summary = value as Record<string, unknown>
  const localizedText = localizeString(summary.text, brandName)
  if (!localizedText?.changed) return { value, changed: false }
  return {
    value: { ...summary, text: localizedText.value },
    changed: true,
  }
}

function localizeFaqValue(value: unknown, brandName?: string): { value: unknown; changed: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false }

  const faq = value as FaqValue
  let changed = false
  const localized = { ...faq }
  for (const field of ['question_zh', 'answer_zh']) {
    const result = localizeString(faq[field], brandName)
    if (!result) continue
    localized[field] = result.value
    changed ||= result.changed
  }

  return { value: changed ? localized : value, changed }
}

async function inBatches<T>(items: T[], callback: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    await Promise.all(items.slice(index, index + BATCH_SIZE).map(callback))
  }
}

async function backfillBrands(
  supabase: ReturnType<typeof createServiceClient>,
  options: CliOptions,
): Promise<BackfillCounts> {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, description, blurb, reputation_summary')
    .order('id', { ascending: true })
  if (error) throw error

  const updates = ((data ?? []) as BrandRow[]).flatMap((brand) => {
    const brandName = brand.name ?? undefined
    const description = localizeString(brand.description, brandName)
    const blurb = localizeString(brand.blurb, brandName)
    const reputation = localizeReputationSummary(brand.reputation_summary, brandName)
    if (!description?.changed && !blurb?.changed && !reputation.changed) return []

    return [{
      id: brand.id,
      patch: {
        ...(description?.changed ? { description: description.value } : {}),
        ...(blurb?.changed ? { blurb: blurb.value } : {}),
        ...(reputation.changed ? { reputation_summary: reputation.value } : {}),
      },
    }]
  })

  if (!options.dryRun) {
    await inBatches(updates, async ({ id, patch }) => {
      const { error: updateError } = await supabase.from('brands').update(patch).eq('id', id)
      if (updateError) throw updateError
    })
  }

  return { updated: updates.length }
}

async function backfillFaq(
  supabase: ReturnType<typeof createServiceClient>,
  options: CliOptions,
): Promise<BackfillCounts> {
  const { data, error } = await supabase
    .from('brand_faq')
    .select(`brand_id, ${FAQ_COLUMNS.join(', ')}`)
  if (error) throw error

  const updates = ((data ?? []) as unknown as FaqRow[]).flatMap((row) => {
    const patch: Record<string, unknown> = {}
    for (const column of FAQ_COLUMNS) {
      const result = localizeFaqValue(row[column])
      if (result.changed) patch[column] = result.value
    }
    return Object.keys(patch).length > 0 ? [{ brandId: row.brand_id, patch }] : []
  })

  if (!options.dryRun) {
    await inBatches(updates, async ({ brandId, patch }) => {
      const { error: updateError } = await supabase.from('brand_faq').update(patch).eq('brand_id', brandId)
      if (updateError) throw updateError
    })
  }

  return { updated: updates.length }
}

async function backfillImages(
  supabase: ReturnType<typeof createServiceClient>,
  options: CliOptions,
): Promise<BackfillCounts> {
  const { data, error } = await supabase
    .from('brand_images')
    .select('id, alt_zh')
    .not('alt_zh', 'is', null)
  if (error) throw error

  const updates = ((data ?? []) as ImageRow[]).flatMap((image) => {
    const localized = localizeString(image.alt_zh)
    return localized?.changed ? [{ id: image.id, altZh: localized.value }] : []
  })

  if (!options.dryRun) {
    await inBatches(updates, async ({ id, altZh }) => {
      const { error: updateError } = await supabase.from('brand_images').update({ alt_zh: altZh }).eq('id', id)
      if (updateError) throw updateError
    })
  }

  return { updated: updates.length }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const supabase = createServiceClient()
  const [brands, faq, images] = await Promise.all([
    backfillBrands(supabase, options),
    backfillFaq(supabase, options),
    backfillImages(supabase, options),
  ])

  console.log(`Brands: ${brands.updated} updated, FAQ: ${faq.updated} updated, Images: ${images.updated} updated`)
  if (options.dryRun) console.log('Dry run complete. No changes made.')
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) return JSON.stringify(error)
  return String(error)
}

if (process.argv[1]?.endsWith('backfill-tw-localization.ts')) {
  void main().catch((error) => {
    console.error(formatError(error))
    process.exitCode = 1
  })
}
