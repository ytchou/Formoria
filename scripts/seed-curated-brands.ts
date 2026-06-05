import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod/v3'
import type { Brand } from '@/lib/types'
import type { Database } from '@/lib/supabase/database.types'
import { brandToInsert, generateSlug, isReservedSlug } from '@/lib/services/brands'
import { createServiceClient } from '@/lib/supabase/server'
import { createSubmissionSchema } from '@/lib/validations/submission'

const DEFAULT_BATCH_SIZE = 100

type BrandInsertRow = Database['public']['Tables']['brands']['Insert']
type RawSeedRow = Record<string, unknown>

const curatedSubmissionSchema = createSubmissionSchema(false).omit({
  _honeypot: true,
  isOwner: true,
  pdpaConsent: true,
  sourceAttribution: true,
  turnstileToken: true,
})

type CuratedSubmission = z.infer<typeof curatedSubmissionSchema>

function printUsage(): void {
  console.log('Usage: tsx --env-file=.env.local scripts/seed-curated-brands.ts <file> [--batch-size=N]')
  console.log('Accepted formats: .json or .csv')
}

function parseArgs(args: string[]): { filePath: string; batchSize: number } {
  const filePath = args[0]
  if (!filePath) {
    printUsage()
    process.exit(1)
  }

  const batchArg = args.find((arg) => arg.startsWith('--batch-size='))
  const batchSize = batchArg ? Number.parseInt(batchArg.replace('--batch-size=', ''), 10) : DEFAULT_BATCH_SIZE

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`Invalid batch size: ${batchArg}`)
  }

  return { filePath, batchSize }
}

function getObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`)
  }

  return value as Record<string, unknown>
}

function getString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (value == null) {
    return ''
  }

  return String(value).trim()
}

function parseJsonString(value: string, fieldName: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON in ${fieldName}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseMaybeJson(value: unknown, fieldName: string): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return value
  }

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value
  }

  return parseJsonString(trimmed, fieldName)
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  const parsedValue = parseMaybeJson(value, fieldName)

  if (Array.isArray(parsedValue)) {
    return parsedValue
      .map((item) => getString(item))
      .filter(Boolean)
  }

  const raw = getString(parsedValue)
  if (!raw) {
    return []
  }

  return raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseObjectArray(value: unknown, fieldName: string): Record<string, unknown>[] {
  const parsedValue = parseMaybeJson(value, fieldName)

  if (parsedValue == null || parsedValue === '') {
    return []
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error(`${fieldName} must be a JSON array`)
  }

  return parsedValue.map((item, index) => getObject(item, `${fieldName}[${index}]`))
}

function parseSocialLinks(value: unknown): Record<string, unknown> {
  const parsedValue = parseMaybeJson(value, 'socialLinks')

  if (parsedValue == null || parsedValue === '') {
    return {}
  }

  return getObject(parsedValue, 'socialLinks')
}

function parseCsvRows(source: string): RawSeedRow[] {
  const rows: string[][] = []
  let currentCell = ''
  let currentRow: string[] = []
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const nextChar = source[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }
      currentRow.push(currentCell)
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow)
      }
      currentCell = ''
      currentRow = []
      continue
    }

    currentCell += char
  }

  currentRow.push(currentCell)
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow)
  }

  if (rows.length === 0) {
    return []
  }

  const [headerRow, ...dataRows] = rows
  const headers = headerRow.map((header) => header.trim())

  return dataRows.map((cells) => {
    const row: RawSeedRow = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    return row
  })
}

async function readInputRows(filePath: string): Promise<RawSeedRow[]> {
  const resolvedPath = path.resolve(filePath)
  const contents = await readFile(resolvedPath, 'utf8')
  const extension = path.extname(resolvedPath).toLowerCase()

  if (extension === '.json') {
    const parsed = JSON.parse(contents) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((item, index) => getObject(item, `rows[${index}]`))
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { brands?: unknown }).brands)) {
      return (parsed as { brands: unknown[] }).brands.map((item, index) =>
        getObject(item, `brands[${index}]`)
      )
    }
    throw new Error('JSON input must be an array or an object with a brands array')
  }

  if (extension === '.csv') {
    return parseCsvRows(contents)
  }

  throw new Error(`Unsupported file type: ${extension}`)
}

function normalizeRow(rawRow: RawSeedRow): CuratedSubmission & { slug: string } {
  const socialLinks =
    'socialLinks' in rawRow ? parseSocialLinks(rawRow.socialLinks) : {}

  const normalized = curatedSubmissionSchema.parse({
    name: getString(rawRow.name),
    description: getString(rawRow.description),
    category: getString(rawRow.category),
    tags: parseStringArray(rawRow.tags, 'tags'),
    logoUrl: getString(rawRow.logoUrl),
    productPhotos: parseStringArray(rawRow.productPhotos, 'productPhotos'),
    brandHighlights: getString(rawRow.brandHighlights),
    purchaseLinks: parseObjectArray(rawRow.purchaseLinks, 'purchaseLinks'),
    socialLinks: {
      instagram: getString(socialLinks.instagram ?? rawRow.instagram),
      threads: getString(socialLinks.threads ?? rawRow.threads),
      facebook: getString(socialLinks.facebook ?? rawRow.facebook),
      website: getString(
        socialLinks.website ?? socialLinks.officialWebsite ?? rawRow.website ?? rawRow.officialWebsite
      ),
    },
    retailLocations: parseObjectArray(rawRow.retailLocations, 'retailLocations'),
  })

  const slug = getString(rawRow.slug) || generateSlug(normalized.name)
  if (!slug) {
    throw new Error(`Unable to generate slug for brand: ${normalized.name}`)
  }
  if (isReservedSlug(slug)) {
    throw new Error(`Slug conflicts with reserved route: ${slug}`)
  }

  return { ...normalized, slug }
}

function curatedSubmissionToBrand(input: CuratedSubmission & { slug: string }): Partial<Brand> {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description,
    logoUrl: input.logoUrl || null,
    heroImageUrl: null,
    status: 'approved',
    category: input.category,
    foundingYear: null,
    purchaseLinks: input.purchaseLinks.map((link) => ({
      ...link,
      label: link.platform,
    })),
    socialLinks: {
      instagram: input.socialLinks.instagram || undefined,
      threads: input.socialLinks.threads || undefined,
      facebook: input.socialLinks.facebook || undefined,
      officialWebsite: input.socialLinks.website || undefined,
    },
    retailLocations: input.retailLocations.map((location) => ({
      ...location,
      latitude: 0,
      longitude: 0,
    })),
    productPhotos: input.productPhotos,
    contactEmail: null,
    brandHighlights: input.brandHighlights.trim() || null,
  }
}

function toInsertRow(input: CuratedSubmission & { slug: string }): BrandInsertRow {
  return {
    ...brandToInsert(curatedSubmissionToBrand(input)),
    approved_at: new Date().toISOString(),
  } as BrandInsertRow
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function seedCuratedBrands(filePath: string, batchSize: number): Promise<void> {
  const rawRows = await readInputRows(filePath)
  if (rawRows.length === 0) {
    console.log('No rows found.')
    return
  }

  const rows = rawRows.map((rawRow, index) => {
    try {
      return toInsertRow(normalizeRow(rawRow))
    } catch (error) {
      throw new Error(`Row ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  const supabase = createServiceClient()
  const batches = chunk(rows, batchSize)

  for (const [index, batch] of batches.entries()) {
    const { error } = await supabase
      .from('brands')
      .upsert(batch, { onConflict: 'slug', ignoreDuplicates: true })

    if (error) {
      throw new Error(`Batch ${index + 1} failed: ${error.message}`)
    }

    console.log(`Inserted batch ${index + 1}/${batches.length} (${batch.length} rows attempted)`)
  }

  console.log(`Done. Processed ${rows.length} curated brand rows.`)
}

async function main(): Promise<void> {
  const { filePath, batchSize } = parseArgs(process.argv.slice(2))
  await seedCuratedBrands(filePath, batchSize)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
