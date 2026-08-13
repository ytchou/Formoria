import { parse as parseYaml } from 'yaml'
import {
  PRODUCT_TYPE_CATEGORIES,
  matchSubcategory,
  normalizeTagKey,
  resolveSubcategorySlugs,
} from '@/lib/taxonomy/ontology'
import { normalizeProductTags } from '@/lib/services/product-tags'

/**
 * Curated-product YAML parser and validator (DEV-1404).
 *
 * PURE BY CONTRACT: this module takes file *contents* as input and imports no
 * database client, no network call, and no filesystem read. The repo's
 * test-boundaries check forbids mocking the DB SDK in tests, so an impure
 * module here would be untestable; the caller reads and hands strings in.
 *
 * The publication gate lives here, at authoring time: a product may not declare
 * `lifecycle: published` unless it has an `official_url`, at least one source,
 * and a `source_checked_at`. Every violation is reported with its file and
 * product key, because an editor fixing YAML needs all of the errors at once.
 *
 * Field names in the YAML stay snake_case to match the DB columns 1:1 (same
 * convention as `content/seo/keyword-map.yaml`); the parsed rows are camelCase,
 * transformed at this boundary.
 */

/** The 12 values of the `curated_products.l1` CHECK constraint. */
export type CuratedProductL1 = (typeof PRODUCT_TYPE_CATEGORIES)[number]['slug']

export const CURATED_PRODUCT_L1_VALUES: readonly CuratedProductL1[] =
  PRODUCT_TYPE_CATEGORIES.map((category) => category.slug)

/**
 * The runtime membership check IS the l1 validation, so it stays a real check;
 * the predicate only teaches the compiler what the check already proved.
 */
export function isCuratedProductL1(value: string): value is CuratedProductL1 {
  return (CURATED_PRODUCT_L1_VALUES as readonly string[]).includes(value)
}

export const CURATED_PRODUCT_LIFECYCLES = [
  'candidate',
  'needs_review',
  'published',
  'retired',
] as const

export const CURATED_PRODUCT_IMAGE_USAGES = ['none', 'permitted', 'licensed'] as const

export const CURATED_SOURCE_TYPES = ['official', 'press', 'retailer', 'other'] as const

export type CuratedProductLifecycle = (typeof CURATED_PRODUCT_LIFECYCLES)[number]
export type CuratedProductImageUsage = (typeof CURATED_PRODUCT_IMAGE_USAGES)[number]
export type CuratedSourceType = (typeof CURATED_SOURCE_TYPES)[number]

export type CuratedProductRow = {
  brandSlug: string
  key: string
  nameZh: string
  nameEn: string | null
  l1: string
  /** Ontology subcategory slugs, already filtered to the product's l1. */
  l2: string[]
  officialUrl: string | null
  imageUrl: string | null
  imageSourceUrl: string | null
  imageUsage: CuratedProductImageUsage
  lifecycle: CuratedProductLifecycle
  sourceCheckedAt: string | null
  reviewDueAt: string | null
  notesZh: string | null
  notesEn: string | null
}

export type CuratedSourceRow = {
  brandSlug: string
  productKey: string
  url: string
  sourceType: CuratedSourceType
  claimZh: string | null
  claimEn: string | null
  checkedAt: string | null
}

export type CuratedSelectionRow = {
  brandSlug: string
  productKey: string
  trailSlug: string
  sectionKey: string
  position: number
  rationaleZh: string
  rationaleEn: string | null
}

export type NormalizeIssue = {
  file: string
  /** `null` for a file-level issue that belongs to no single product. */
  productKey: string | null
  message: string
}

export type CuratedContentFile = { name: string; content: string }

export type ParsedProductFile = {
  products: CuratedProductRow[]
  sources: CuratedSourceRow[]
  issues: NormalizeIssue[]
}

export type ParsedSelectionFile = {
  trailSlug: string
  selections: CuratedSelectionRow[]
  issues: NormalizeIssue[]
}

export type NormalizeCuratedContentInput = {
  productFiles: CuratedContentFile[]
  selectionFiles: CuratedContentFile[]
  /** Trail slugs the site actually renders. A selection outside it is an error. */
  knownTrailSlugs: string[]
}

export type NormalizeCuratedContentResult = {
  products: CuratedProductRow[]
  sources: CuratedSourceRow[]
  selections: CuratedSelectionRow[]
  issues: NormalizeIssue[]
}

type Dict = Record<string, unknown>

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function slugFromFileName(fileName: string): string {
  return (fileName.split('/').pop() ?? fileName).replace(/\.ya?ml$/i, '')
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  return null
}

/**
 * `yaml` leaves an unquoted `2026-08-01T00:00:00Z` as a string under the core
 * schema, but a custom schema or a `Date` handed in by a programmatic caller
 * must not silently become `"[object Object]"`.
 */
function readTimestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  return readString(value)
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = readString(item)
    return text ? [text] : []
  })
}

/**
 * Resolves authored l2 labels to ontology subcategory slugs through the shared
 * vocabulary — no local tag matching. Anything that does not survive the
 * round-trip is REPORTED, never silently dropped.
 */
function resolveL2(
  rawTags: string[],
  l1: string,
): { slugs: string[]; messages: string[] } {
  const messages: string[] = []
  if (rawTags.length === 0) return { slugs: [], messages }

  const normalized = normalizeProductTags(rawTags, [], l1)
  for (const rejection of normalized.rejected) {
    messages.push(`unmatched l2 tag "${rejection.tag}" (${rejection.reason})`)
  }

  // Anything the shared normalizer dropped without rejecting (unresolved
  // composite halves, the 5-tag cap) would otherwise vanish without a trace.
  const accountedFor = new Set<string>([
    ...normalized.tags.map(normalizeTagKey),
    ...normalized.rejected.map((rejection) => normalizeTagKey(rejection.tag)),
  ])
  for (const raw of rawTags) {
    const key = normalizeTagKey(raw)
    if (!key || accountedFor.has(key)) continue
    const canonical = matchSubcategory(raw)
    if (canonical && accountedFor.has(normalizeTagKey(canonical.nameZh))) continue
    messages.push(`unmatched l2 tag "${raw}"`)
  }

  const slugs: string[] = []
  for (const tag of normalized.tags) {
    const subcategory = matchSubcategory(tag)
    if (!subcategory) {
      messages.push(`unmatched l2 tag "${tag}"`)
      continue
    }
    if (!slugs.includes(subcategory.slug)) slugs.push(subcategory.slug)
  }

  const resolved = resolveSubcategorySlugs(l1, slugs)
  const kept = new Set(resolved.map((subcategory) => subcategory.slug))
  for (const slug of slugs) {
    if (!kept.has(slug)) {
      messages.push(`l2 tag "${slug}" does not belong to l1 "${l1}"`)
    }
  }

  return { slugs: resolved.map((subcategory) => subcategory.slug), messages }
}

function parseDocument(
  fileName: string,
  content: string,
): { doc: Dict | null; issues: NormalizeIssue[] } {
  let parsed: unknown
  try {
    parsed = parseYaml(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      doc: null,
      issues: [{ file: fileName, productKey: null, message: `invalid YAML: ${message}` }],
    }
  }
  if (!isDict(parsed)) {
    return {
      doc: null,
      issues: [
        { file: fileName, productKey: null, message: 'expected a YAML mapping at the root' },
      ],
    }
  }
  return { doc: parsed, issues: [] }
}

export function parseCuratedProductFile(
  fileName: string,
  content: string,
): ParsedProductFile {
  const { doc, issues } = parseDocument(fileName, content)
  const products: CuratedProductRow[] = []
  const sources: CuratedSourceRow[] = []
  if (!doc) return { products, sources, issues }

  const brandSlug = readString(doc.brand_slug) ?? slugFromFileName(fileName)
  const entries = Array.isArray(doc.products) ? doc.products : null
  if (!entries) {
    issues.push({
      file: fileName,
      productKey: null,
      message: 'expected a `products` list',
    })
    return { products, sources, issues }
  }

  const seenKeys = new Set<string>()
  entries.forEach((entry, index) => {
    if (!isDict(entry)) {
      issues.push({
        file: fileName,
        productKey: null,
        message: `products[${index}] is not a mapping`,
      })
      return
    }

    const key = readString(entry.key)
    const productKey = key ?? `products[${index}]`
    const fail = (message: string): void => {
      issues.push({ file: fileName, productKey, message })
    }
    let valid = true
    const reject = (message: string): void => {
      fail(message)
      valid = false
    }

    if (!key) reject('missing key')
    else if (seenKeys.has(key)) reject(`duplicate key: ${key}`)
    else seenKeys.add(key)

    const nameZh = readString(entry.name_zh)
    if (!nameZh) reject('missing name_zh')

    const l1 = readString(entry.l1)
    if (!l1) reject('missing l1')
    else if (!isCuratedProductL1(l1)) {
      reject(`unknown l1 value: ${l1}`)
    }

    const lifecycle = readString(entry.lifecycle) ?? 'candidate'
    if (!(CURATED_PRODUCT_LIFECYCLES as readonly string[]).includes(lifecycle)) {
      reject(`unknown lifecycle value: ${lifecycle}`)
    }

    const imageUsage = readString(entry.image_usage) ?? 'none'
    if (!(CURATED_PRODUCT_IMAGE_USAGES as readonly string[]).includes(imageUsage)) {
      reject(`unknown image_usage value: ${imageUsage}`)
    }

    const officialUrl = readString(entry.official_url)
    const sourceCheckedAt = readTimestamp(entry.source_checked_at)

    const rawSources = Array.isArray(entry.sources) ? entry.sources : []
    const parsedSources: CuratedSourceRow[] = []
    const seenUrls = new Set<string>()
    rawSources.forEach((rawSource, sourceIndex) => {
      if (!isDict(rawSource)) {
        reject(`sources[${sourceIndex}] is not a mapping`)
        return
      }
      const url = readString(rawSource.url)
      if (!url) {
        reject(`sources[${sourceIndex}] is missing url`)
        return
      }
      if (seenUrls.has(url)) {
        reject(`duplicate source url: ${url}`)
        return
      }
      seenUrls.add(url)
      const sourceType = readString(rawSource.source_type) ?? 'official'
      if (!(CURATED_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
        reject(`unknown source_type value: ${sourceType}`)
        return
      }
      parsedSources.push({
        brandSlug,
        productKey: key ?? '',
        url,
        sourceType: sourceType as CuratedSourceType,
        claimZh: readString(rawSource.claim_zh),
        claimEn: readString(rawSource.claim_en),
        checkedAt: readTimestamp(rawSource.checked_at),
      })
    })

    // The publication gate. All three checks run so the editor sees every
    // missing piece in one pass, not one error per fix cycle.
    if (lifecycle === 'published') {
      if (!officialUrl) reject('published requires official_url')
      if (parsedSources.length === 0) reject('published requires at least one source')
      if (!sourceCheckedAt) reject('published requires source_checked_at')
    }

    const l2 = l1 ? resolveL2(readStringArray(entry.l2), l1) : { slugs: [], messages: [] }
    for (const message of l2.messages) fail(message)

    if (!valid || !key || !nameZh || !l1) return

    products.push({
      brandSlug,
      key,
      nameZh,
      nameEn: readString(entry.name_en),
      l1,
      l2: l2.slugs,
      officialUrl,
      imageUrl: readString(entry.image_url),
      imageSourceUrl: readString(entry.image_source_url),
      imageUsage: imageUsage as CuratedProductImageUsage,
      lifecycle: lifecycle as CuratedProductLifecycle,
      sourceCheckedAt,
      reviewDueAt: readTimestamp(entry.review_due_at),
      notesZh: readString(entry.notes_zh),
      notesEn: readString(entry.notes_en),
    })
    sources.push(...parsedSources)
  })

  return { products, sources, issues }
}

export function parseCuratedSelectionFile(
  fileName: string,
  content: string,
): ParsedSelectionFile {
  const { doc, issues } = parseDocument(fileName, content)
  const selections: CuratedSelectionRow[] = []
  const fallbackTrailSlug = slugFromFileName(fileName)
  if (!doc) return { trailSlug: fallbackTrailSlug, selections, issues }

  const trailSlug = readString(doc.trail_slug) ?? fallbackTrailSlug
  const entries = Array.isArray(doc.selections) ? doc.selections : null
  if (!entries) {
    issues.push({
      file: fileName,
      productKey: null,
      message: 'expected a `selections` list',
    })
    return { trailSlug, selections, issues }
  }

  const seen = new Set<string>()
  entries.forEach((entry, index) => {
    if (!isDict(entry)) {
      issues.push({
        file: fileName,
        productKey: null,
        message: `selections[${index}] is not a mapping`,
      })
      return
    }
    const reference = readString(entry.product)
    const fail = (message: string): void => {
      issues.push({ file: fileName, productKey: reference, message })
    }
    if (!reference) {
      issues.push({
        file: fileName,
        productKey: null,
        message: `selections[${index}] is missing product`,
      })
      return
    }
    const [brandSlug, productKey, ...rest] = reference.split('/')
    if (!brandSlug || !productKey || rest.length > 0) {
      fail(`product must be "<brand-slug>/<product-key>": ${reference}`)
      return
    }
    const sectionKey = readString(entry.section_key)
    if (!sectionKey) {
      fail('missing section_key')
      return
    }
    const rationaleZh = readString(entry.rationale_zh)
    if (!rationaleZh) {
      fail('missing rationale_zh')
      return
    }
    const identity = `${reference}\u0000${sectionKey}`
    if (seen.has(identity)) {
      fail(`duplicate selection for section ${sectionKey}`)
      return
    }
    seen.add(identity)

    const rawPosition = entry.position
    const position =
      typeof rawPosition === 'number' && Number.isInteger(rawPosition) ? rawPosition : 0
    if (rawPosition !== undefined && typeof rawPosition !== 'number') {
      fail(`position must be an integer: ${String(rawPosition)}`)
      return
    }

    selections.push({
      brandSlug,
      productKey,
      trailSlug,
      sectionKey,
      position,
      rationaleZh,
      rationaleEn: readString(entry.rationale_en),
    })
  })

  return { trailSlug, selections, issues }
}

/**
 * Parses every file and runs the cross-file checks that no single file can do
 * on its own: a selection must point at a product that exists, and must sit on
 * a trail the site actually renders.
 */
export function normalizeCuratedContent(
  input: NormalizeCuratedContentInput,
): NormalizeCuratedContentResult {
  const products: CuratedProductRow[] = []
  const sources: CuratedSourceRow[] = []
  const selections: CuratedSelectionRow[] = []
  const issues: NormalizeIssue[] = []

  for (const file of input.productFiles) {
    const parsed = parseCuratedProductFile(file.name, file.content)
    products.push(...parsed.products)
    sources.push(...parsed.sources)
    issues.push(...parsed.issues)
  }

  const knownProducts = new Set(
    products.map((product) => `${product.brandSlug}/${product.key}`),
  )
  const knownTrailSlugs = new Set(input.knownTrailSlugs)

  for (const file of input.selectionFiles) {
    const parsed = parseCuratedSelectionFile(file.name, file.content)
    issues.push(...parsed.issues)
    if (!knownTrailSlugs.has(parsed.trailSlug)) {
      issues.push({
        file: file.name,
        productKey: null,
        message: `unknown trail_slug: ${parsed.trailSlug}`,
      })
      continue
    }
    for (const selection of parsed.selections) {
      const reference = `${selection.brandSlug}/${selection.productKey}`
      if (!knownProducts.has(reference)) {
        issues.push({
          file: file.name,
          productKey: reference,
          message: `unknown product reference: ${reference}`,
        })
        continue
      }
      selections.push(selection)
    }
  }

  return { products, sources, selections, issues }
}
