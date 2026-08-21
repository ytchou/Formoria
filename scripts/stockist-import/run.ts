import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { upsertEnrichedStockists } from '@/lib/services/stockists'
import { parseStockistCsv, type StockistCsvRow } from './normalize'
import { planStockistImport, type ApprovedBrand } from './plan'

const DATASET_DIR = resolve(process.cwd(), 'content/stockists')
const QUERY_CHUNK_SIZE = 100
const WRITE_BATCH_SIZE = 10

type CliOptions = { apply: boolean; category: string | null }

function parseArgs(argv: string[]): CliOptions {
  const categoryArg = argv.find((arg) => arg.startsWith('--category='))
  const categoryIndex = argv.indexOf('--category')
  const category = categoryArg
    ? categoryArg.slice('--category='.length)
    : categoryIndex === -1
      ? null
      : (argv.at(categoryIndex + 1) ?? null)
  if (category !== null && (!category || category.startsWith('--'))) {
    throw new Error('--category requires a category file stem')
  }
  return { apply: argv.includes('--apply'), category }
}

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function loadRows(category: string | null): Promise<StockistCsvRow[]> {
  const files = (await readdir(DATASET_DIR))
    .filter((file) => file.endsWith('.csv'))
    .filter((file) => category === null || file === `${category}.csv`)
    .sort()
  if (files.length === 0) {
    throw new Error(
      category ? `unknown category: ${category}` : 'no stockist CSV files',
    )
  }

  const datasets = await Promise.all(
    files.map(async (file) =>
      parseStockistCsv(
        await readFile(resolve(DATASET_DIR, file), 'utf8'),
        file,
      ),
    ),
  )
  return datasets.flat()
}

async function loadApprovedBrands(slugs: string[]): Promise<ApprovedBrand[]> {
  const supabase = createServiceClient()
  const results = await Promise.all(
    chunked([...new Set(slugs)], QUERY_CHUNK_SIZE).map(async (slugChunk) => {
      const { data, error } = await supabase
        .from('brands')
        .select('id, slug')
        .eq('status', 'approved')
        .in('slug', slugChunk)
      if (error) throw error
      return (data ?? []) as ApprovedBrand[]
    }),
  )
  return results.flat()
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const rows = await loadRows(options.category)

  // Parsing and validation complete before the first client is created, so a
  // malformed file cannot leave a half-written production import.
  const approvedBrands = await loadApprovedBrands(
    rows.map((row) => row.brand_slug),
  )
  const plan = planStockistImport(rows, approvedBrands)

  console.log(
    JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      category: options.category,
      totals: plan.totals,
      unmatchedSlugs: plan.unmatchedSlugs,
    }),
  )
  for (const brand of plan.brands) {
    console.log(
      JSON.stringify({
        brandSlug: brand.brandSlug,
        inserts: brand.candidates.length,
        heldBack: brand.heldBack,
        dedupeCollapses: brand.collapsed,
      }),
    )
  }
  for (const reject of plan.rejected) console.error(JSON.stringify(reject))

  if (!options.apply) return
  if (plan.rejected.length > 0) {
    throw new Error('refusing to apply a plan with rejected rows')
  }

  for (const batch of chunked(plan.brands, WRITE_BATCH_SIZE)) {
    await Promise.all(
      batch.map(async (brand) => {
        const result = await upsertEnrichedStockists(
          brand.brandId,
          brand.candidates,
        )
        if (!result.ok) {
          throw new Error(`${brand.brandSlug}: ${result.code}`)
        }
        if (result.count !== brand.candidates.length) {
          throw new Error(
            `${brand.brandSlug}: expected ${brand.candidates.length} upserts, received ${result.count}`,
          )
        }
      }),
    )
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
