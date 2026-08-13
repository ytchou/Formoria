import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { auditedCall } from '@/lib/audit'
import { requestPublicBrandRevalidation } from '@/lib/cache/revalidate-client'
import { processImage } from '@/lib/security/image-processor'
import { uploadPublicImage } from '@/lib/services/image-upload'
import { createServiceClient } from '@/lib/supabase/service'
import { isPrivateUrl } from '@/lib/url'

import {
  normalizeCuratedContent,
  type CuratedContentFile,
  type CuratedProductRow,
  type CuratedSelectionRow,
  type CuratedSourceRow,
  type NormalizeIssue,
} from './normalize'
import {
  CURATED_PRODUCT_CONFLICT_TARGET,
  CURATED_PRODUCT_WRITE_COLUMNS,
  CURATED_SELECTION_CONFLICT_TARGET,
  CURATED_SOURCE_CONFLICT_TARGET,
  planCuratedProductSync,
  type CuratedPlanOperation,
  type CuratedProductValues,
  type CuratedSyncPlan,
  type CurrentCuratedProduct,
  type CurrentCuratedSelection,
  type CurrentCuratedSource,
} from './plan'

/**
 * Curated-product YAML → database applier (DEV-1404).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/run.ts
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/run.ts --apply
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/run.ts --brand=hanchor
 *
 * DRY RUN IS THE DEFAULT. Nothing is written and nothing is uploaded without
 * `--apply`; the planner is pure, so a dry run is a read-only report.
 *
 * WRITE ORDER IS LOAD-BEARING. `curated_product_sources` and
 * `curated_product_selections` are keyed by `product_id`, which does not exist
 * until the parent insert lands. Products are therefore written first, the
 * `(brand_id, key)` business keys are re-read into UUIDs, and only then are the
 * children written. The planner emits its operations in that order already —
 * this module must not reorder them.
 *
 * EVERY WRITE IS AN UPSERT on a conflict target imported from ./plan, so a run
 * interrupted halfway is safe to re-run: the second run converges instead of
 * duplicating. The conflict targets are imported, never retyped as literals —
 * a local copy that drifts from the migration's unique index silently turns
 * every upsert into an insert.
 *
 * EVERY UPSERT PAYLOAD IS A FULL ROW. Postgres evaluates NOT NULL and CHECK
 * constraints on the proposed tuple BEFORE the ON CONFLICT arbiter runs, so a
 * partial payload (`{product_id, trail_slug, section_key, state}` for a retire,
 * say) fails on `rationale_zh` even though the row it would have updated
 * exists. Retires are therefore built from the current row plus the state flip.
 *
 * IMAGES ARE MIRRORED, NOT LINKED, and deliberately NOT through the enrichment
 * image downloader in src/lib/services/image-download.ts: its EnrichmentTarget
 * is a closed brand|submission union that maps to a fixed image TABLE (a
 * curated product keeps its image on the product ROW), and it uploads to a
 * randomly generated path, which would store a NEW object on every apply and
 * orphan the previous one. The key here is
 * `curated-products/<brand-id>/<product-id>/<sha256(image_source_url)>.webp`
 * with `upsert: true`, so re-applying overwrites in place. BRAND ID COMES FIRST
 * because `scripts/remove-brand.ts` deletes a brand's curated images by listing
 * exactly one prefix, `curated-products/<brand-id>`.
 */

const CONTENT_DIR = resolve(process.cwd(), 'content/curated-products')
const PRODUCT_DIR = resolve(CONTENT_DIR, 'products')
const SELECTION_DIR = resolve(CONTENT_DIR, 'selections')

const BRAND_IMAGES_BUCKET = 'brand-images' as const
const CURATED_IMAGE_PREFIX = 'curated-products'

/** Matches the stockist importer's read/write sizes; see scripts/stockist-import/run.ts. */
const QUERY_CHUNK_SIZE = 100
const WRITE_BATCH_SIZE = 100

const IMAGE_FETCH_TIMEOUT_MS = 20_000
const IMAGE_PROCESSOR_CONFIG = {
  maxWidth: 1600,
  maxHeight: 1600,
  maxFileSizeBytes: 30 * 1024 * 1024,
}
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

type CuratedSyncClient = ReturnType<typeof createServiceClient>

export type CuratedSyncContent = {
  products: CuratedProductRow[]
  sources: CuratedSourceRow[]
  selections: CuratedSelectionRow[]
}

export type CuratedImageAction = 'uploaded' | 'reused' | 'skipped'

export type CuratedImageOutcome = {
  brandSlug: string
  productKey: string
  action: CuratedImageAction
  /** Null when nothing is (or would be) stored for this product. */
  storageKey: string | null
  /** Present on `skipped` only. */
  reason?: string
}

export type CuratedSyncResult = {
  applied: boolean
  totals: CuratedSyncPlan['totals']
  operations: number
  unmatchedBrandSlugs: string[]
  images: CuratedImageOutcome[]
  /** Brand slugs whose public pages need revalidating. */
  affectedBrandSlugs: string[]
}

export type CuratedSyncOptions = {
  content: CuratedSyncContent
  brandIdBySlug: Record<string, string>
  apply: boolean
  client?: CuratedSyncClient
  /**
   * Seam for the integration test. The default is an audited `fetch`; a test
   * supplies bytes directly so the suite makes no outbound request.
   */
  downloadImage?: (url: string) => Promise<Buffer>
}

// ---------------------------------------------------------------------------
// image storage
// ---------------------------------------------------------------------------

/**
 * Deterministic object key. Derived from `image_source_url` and NEVER from a
 * random UUID: the same authored source must resolve to the same object on
 * every run, otherwise each apply uploads a new object and orphans the last.
 */
export function curatedImageStorageKey(
  brandId: string,
  productId: string,
  imageSourceUrl: string,
): string {
  const digest = createHash('sha256').update(imageSourceUrl).digest('hex')
  return `${CURATED_IMAGE_PREFIX}/${brandId}/${productId}/${digest}.webp`
}

function publicUrlFor(client: CuratedSyncClient, storageKey: string): string {
  return client.storage.from(BRAND_IMAGES_BUCKET).getPublicUrl(storageKey).data
    .publicUrl
}

/**
 * `image_usage` gates the mirror, and only `permitted` opens it. `licensed`
 * deliberately does NOT: a formal licence names where the file may be served
 * from, and copying those bytes into our own bucket is exactly the decision a
 * sync script must not make on an editor's behalf.
 */
function isMirrorable(row: CuratedProductRow): boolean {
  return Boolean(
    row.imageUsage === 'permitted' && row.imageSourceUrl && row.imageUrl,
  )
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  if (isPrivateUrl(url)) {
    throw new Error(`refusing to fetch a private image URL: ${url}`)
  }

  return auditedCall(
    { provider: 'http', operation: 'fetch_curated_image', kind: 'external' },
    async (ctx): Promise<Buffer> => {
      const response = await fetch(url, {
        headers: { 'User-Agent': BROWSER_UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      })
      ctx.summary.status = response.status
      if (!response.ok) {
        throw new Error(`image fetch failed (${response.status}): ${url}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      ctx.summary.bytes = buffer.length
      return buffer
    },
  )
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function identity(brandId: string, key: string): string {
  return `${brandId}\u0000${key}`
}

const PRODUCT_SELECT = ['id', ...CURATED_PRODUCT_WRITE_COLUMNS].join(', ')

async function loadCurrentProducts(
  client: CuratedSyncClient,
  brandIds: string[],
): Promise<CurrentCuratedProduct[]> {
  const rows: CurrentCuratedProduct[] = []
  for (const chunk of chunked(brandIds, QUERY_CHUNK_SIZE)) {
    const { data, error } = await client
      .from('curated_products')
      .select(PRODUCT_SELECT)
      .in('brand_id', chunk)
    if (error) throw new Error(`failed to read curated_products: ${error.message}`)
    rows.push(...((data ?? []) as unknown as CurrentCuratedProduct[]))
  }
  return rows
}

async function loadCurrentChildren(
  client: CuratedSyncClient,
  productIds: string[],
): Promise<{
  sources: CurrentCuratedSource[]
  selections: CurrentCuratedSelection[]
}> {
  const sources: CurrentCuratedSource[] = []
  const selections: CurrentCuratedSelection[] = []

  for (const chunk of chunked(productIds, QUERY_CHUNK_SIZE)) {
    const [sourceResult, selectionResult] = await Promise.all([
      client
        .from('curated_product_sources')
        .select('id, product_id, url, source_type, claim_zh, claim_en, checked_at, state')
        .in('product_id', chunk),
      client
        .from('curated_product_selections')
        .select('product_id, trail_slug, section_key, position, rationale_zh, rationale_en, state')
        .in('product_id', chunk),
    ])
    if (sourceResult.error) {
      throw new Error(
        `failed to read curated_product_sources: ${sourceResult.error.message}`,
      )
    }
    if (selectionResult.error) {
      throw new Error(
        `failed to read curated_product_selections: ${selectionResult.error.message}`,
      )
    }
    sources.push(...((sourceResult.data ?? []) as unknown as CurrentCuratedSource[]))
    selections.push(
      ...((selectionResult.data ?? []) as unknown as CurrentCuratedSelection[]),
    )
  }

  return { sources, selections }
}

// ---------------------------------------------------------------------------
// desired state
// ---------------------------------------------------------------------------

function productWriteValues(
  row: CurrentCuratedProduct | CuratedProductValues,
): CuratedProductValues {
  return Object.fromEntries(
    CURATED_PRODUCT_WRITE_COLUMNS.map((column) => [column, row[column]]),
  ) as CuratedProductValues
}

/**
 * Replaces the authored `image_url` with the mirror this run will store, for
 * every product whose row already exists.
 *
 * WITHOUT THIS THE SYNC NEVER CONVERGES. The applier owns `image_url` — it is
 * the only reference the storage sweep can resolve a curated object by
 * (scripts/brand-storage-maintenance.ts) — while the planner reads
 * `image_url` straight from the YAML. Left alone, run N writes the mirror URL
 * and run N+1 plans an update back to the authored URL, forever, and the
 * "second apply writes nothing" guarantee is dead. The authored `image_url`
 * keeps its real job: it is where the bytes are FETCHED from.
 *
 * A product with no row yet has no id, so its first run stores the authored
 * URL and the image phase immediately rewrites it to the mirror.
 */
function withMirroredImageUrls(
  products: CuratedProductRow[],
  brandIdBySlug: Record<string, string>,
  productIdByKey: Map<string, string>,
  client: CuratedSyncClient,
): CuratedProductRow[] {
  return products.map((row) => {
    if (!isMirrorable(row)) return row
    const brandId = brandIdBySlug[row.brandSlug]
    if (!brandId) return row
    const productId = productIdByKey.get(identity(brandId, row.key))
    if (!productId) return row
    const storageKey = curatedImageStorageKey(
      brandId,
      productId,
      row.imageSourceUrl!,
    )
    return { ...row, imageUrl: publicUrlFor(client, storageKey) }
  })
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

async function upsertRows(
  client: CuratedSyncClient,
  table: string,
  rows: Record<string, unknown>[],
  conflictTarget: readonly string[],
): Promise<void> {
  if (rows.length === 0) return
  for (const batch of chunked(rows, WRITE_BATCH_SIZE)) {
    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: conflictTarget.join(',') })
    if (error) throw new Error(`failed to upsert ${table}: ${error.message}`)
  }
}

function productPayloads(
  operations: CuratedPlanOperation[],
  currentById: Map<string, CurrentCuratedProduct>,
): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = []
  for (const operation of operations) {
    if (operation.kind === 'product.insert') {
      payloads.push({ ...operation.values })
      continue
    }
    if (operation.kind !== 'product.update' && operation.kind !== 'product.retire') {
      continue
    }
    const current = currentById.get(operation.id)
    if (!current) {
      throw new Error(
        `missing current row for ${operation.product.key}; re-run the plan`,
      )
    }
    payloads.push({ ...productWriteValues(current), ...operation.set })
  }
  return payloads
}

function sourceKey(productId: string, url: string): string {
  return `${productId}\u0000${url}`
}

function selectionKey(
  productId: string,
  trailSlug: string,
  sectionKey: string,
): string {
  return `${productId}\u0000${trailSlug}\u0000${sectionKey}`
}

function childPayloads(
  operations: CuratedPlanOperation[],
  productIdByKey: Map<string, string>,
  currentSources: Map<string, CurrentCuratedSource>,
  currentSelections: Map<string, CurrentCuratedSelection>,
): { sources: Record<string, unknown>[]; selections: Record<string, unknown>[] } {
  const sources: Record<string, unknown>[] = []
  const selections: Record<string, unknown>[] = []

  const resolveProductId = (operation: CuratedPlanOperation): string => {
    const key = identity(operation.product.brandId, operation.product.key)
    const productId = productIdByKey.get(key)
    if (!productId) {
      throw new Error(
        `could not resolve product id for ${operation.product.key}; the parent write did not land`,
      )
    }
    return productId
  }

  for (const operation of operations) {
    switch (operation.kind) {
      case 'source.upsert': {
        const productId = operation.productId ?? resolveProductId(operation)
        sources.push({
          product_id: productId,
          url: operation.url,
          ...operation.values,
        })
        break
      }
      case 'source.retire': {
        const current = currentSources.get(
          sourceKey(operation.productId, operation.url),
        )
        if (!current) break
        sources.push({
          product_id: current.product_id,
          url: current.url,
          source_type: current.source_type,
          claim_zh: current.claim_zh,
          claim_en: current.claim_en,
          checked_at: current.checked_at,
          ...operation.set,
        })
        break
      }
      case 'selection.upsert': {
        const productId = operation.productId ?? resolveProductId(operation)
        selections.push({
          product_id: productId,
          trail_slug: operation.trailSlug,
          section_key: operation.sectionKey,
          ...operation.values,
        })
        break
      }
      case 'selection.retire': {
        const current = currentSelections.get(
          selectionKey(
            operation.productId,
            operation.trailSlug,
            operation.sectionKey,
          ),
        )
        if (!current) break
        selections.push({
          product_id: current.product_id,
          trail_slug: current.trail_slug,
          section_key: current.section_key,
          position: current.position,
          rationale_zh: current.rationale_zh,
          rationale_en: current.rationale_en,
          ...operation.set,
        })
        break
      }
      default:
        break
    }
  }

  return { sources, selections }
}

// ---------------------------------------------------------------------------
// image phase
// ---------------------------------------------------------------------------

async function syncProductImages(options: {
  client: CuratedSyncClient
  products: CuratedProductRow[]
  brandIdBySlug: Record<string, string>
  rowsById: Map<string, CurrentCuratedProduct>
  productIdByKey: Map<string, string>
  apply: boolean
  downloadImage: (url: string) => Promise<Buffer>
}): Promise<CuratedImageOutcome[]> {
  const outcomes: CuratedImageOutcome[] = []

  for (const row of options.products) {
    const brandId = options.brandIdBySlug[row.brandSlug]
    if (!brandId) continue

    const base = { brandSlug: row.brandSlug, productKey: row.key }

    if (row.imageUsage !== 'permitted') {
      outcomes.push({
        ...base,
        action: 'skipped',
        storageKey: null,
        reason: `image_usage=${row.imageUsage}`,
      })
      continue
    }
    if (!row.imageSourceUrl || !row.imageUrl) {
      outcomes.push({
        ...base,
        action: 'skipped',
        storageKey: null,
        reason: 'missing image_url or image_source_url',
      })
      continue
    }

    const productId = options.productIdByKey.get(identity(brandId, row.key))
    if (!productId) {
      outcomes.push({
        ...base,
        action: 'skipped',
        storageKey: null,
        reason: 'product row not written yet',
      })
      continue
    }

    const storageKey = curatedImageStorageKey(
      brandId,
      productId,
      row.imageSourceUrl,
    )
    const mirrorUrl = publicUrlFor(options.client, storageKey)
    const stored = options.rowsById.get(productId)

    // The row already points at the object this run would write. Re-uploading
    // would be harmless (the key is deterministic and the upload upserts) but
    // it would re-fetch every source image on every run.
    if (stored && stored.image_url === mirrorUrl) {
      outcomes.push({ ...base, action: 'reused', storageKey })
      continue
    }

    if (!options.apply) {
      outcomes.push({ ...base, action: 'uploaded', storageKey })
      continue
    }

    const processed = await processImage(
      await options.downloadImage(row.imageUrl),
      IMAGE_PROCESSOR_CONFIG,
    )
    await uploadPublicImage({
      bucket: BRAND_IMAGES_BUCKET,
      path: storageKey,
      data: processed.buffer,
      contentType: processed.contentType,
      upsert: true,
    })

    // Full row, never `{brand_id, key, image_url}`: Postgres checks NOT NULL on
    // the proposed tuple before the ON CONFLICT arbiter, so a partial payload
    // fails on `name_zh` even though the row exists. It always exists here —
    // the product phase ran and its rows were re-read — so a miss is a bug, not
    // a case to paper over with a partial write.
    if (!stored) {
      throw new Error(
        `product row for ${row.brandSlug}/${row.key} disappeared before its image write`,
      )
    }
    await upsertRows(
      options.client,
      'curated_products',
      [
        {
          ...productWriteValues(stored),
          brand_id: brandId,
          key: row.key,
          image_url: mirrorUrl,
        },
      ],
      CURATED_PRODUCT_CONFLICT_TARGET,
    )
    outcomes.push({ ...base, action: 'uploaded', storageKey })
  }

  return outcomes
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

export async function syncCuratedProducts(
  options: CuratedSyncOptions,
): Promise<CuratedSyncResult> {
  const client = options.client ?? createServiceClient()
  const downloadImage = options.downloadImage ?? fetchImageBytes
  const brandIds = [...new Set(Object.values(options.brandIdBySlug))]

  const currentProducts = await loadCurrentProducts(client, brandIds)
  const { sources: currentSources, selections: currentSelections } =
    await loadCurrentChildren(
      client,
      currentProducts.map((row) => row.id),
    )

  const productIdByKey = new Map(
    currentProducts.map((row) => [
      identity(String(row.brand_id), String(row.key)),
      row.id,
    ]),
  )

  const plan = planCuratedProductSync({
    products: withMirroredImageUrls(
      options.content.products,
      options.brandIdBySlug,
      productIdByKey,
      client,
    ),
    sources: options.content.sources,
    selections: options.content.selections,
    brandIdBySlug: options.brandIdBySlug,
    current: {
      products: currentProducts,
      sources: currentSources,
      selections: currentSelections,
    },
  })

  let rows = currentProducts
  let rowsById = new Map(currentProducts.map((row) => [row.id, row]))

  if (options.apply && plan.operations.length > 0) {
    await upsertRows(
      client,
      'curated_products',
      productPayloads(plan.operations, rowsById),
      CURATED_PRODUCT_CONFLICT_TARGET,
    )

    // Re-read AFTER the parent writes: a `product.insert` has no id until now,
    // and every child payload is keyed by one.
    rows = await loadCurrentProducts(client, brandIds)
    rowsById = new Map(rows.map((row) => [row.id, row]))
    for (const row of rows) {
      productIdByKey.set(identity(String(row.brand_id), String(row.key)), row.id)
    }

    const payloads = childPayloads(
      plan.operations,
      productIdByKey,
      new Map(
        currentSources.map((row) => [sourceKey(row.product_id, row.url), row]),
      ),
      new Map(
        currentSelections.map((row) => [
          selectionKey(row.product_id, row.trail_slug, row.section_key),
          row,
        ]),
      ),
    )
    await upsertRows(
      client,
      'curated_product_sources',
      payloads.sources,
      CURATED_SOURCE_CONFLICT_TARGET,
    )
    await upsertRows(
      client,
      'curated_product_selections',
      payloads.selections,
      CURATED_SELECTION_CONFLICT_TARGET,
    )
  }

  const images = await syncProductImages({
    client,
    products: options.content.products,
    brandIdBySlug: options.brandIdBySlug,
    rowsById,
    productIdByKey,
    apply: options.apply,
    downloadImage,
  })

  const touchedBrandIds = new Set<string>()
  for (const operation of plan.operations) {
    touchedBrandIds.add(operation.product.brandId)
  }
  const uploadedKeys = new Set(
    images
      .filter((image) => image.action === 'uploaded')
      .map((image) => image.brandSlug),
  )
  const brandSlugByIdEntries = Object.entries(options.brandIdBySlug)
  const affectedBrandSlugs = [
    ...new Set([
      ...brandSlugByIdEntries
        .filter(([, brandId]) => touchedBrandIds.has(brandId))
        .map(([slug]) => slug),
      ...uploadedKeys,
    ]),
  ].sort()

  return {
    applied: options.apply,
    totals: plan.totals,
    operations: plan.operations.length,
    unmatchedBrandSlugs: plan.unmatchedBrandSlugs,
    images,
    affectedBrandSlugs,
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type CliOptions = { apply: boolean; brand: string | null }

export function parseArgs(argv: string[]): CliOptions {
  const brandArg = argv.find((arg) => arg.startsWith('--brand='))
  const brandIndex = argv.indexOf('--brand')
  const brand = brandArg
    ? brandArg.slice('--brand='.length)
    : brandIndex === -1
      ? null
      : (argv.at(brandIndex + 1) ?? null)
  if (brand !== null && (!brand || brand.startsWith('--'))) {
    throw new Error('--brand requires a brand slug')
  }
  return { apply: argv.includes('--apply'), brand }
}

async function loadContentFiles(directory: string): Promise<CuratedContentFile[]> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }
  const files = entries.filter((entry) => /\.ya?ml$/i.test(entry)).sort()
  return Promise.all(
    files.map(async (file) => ({
      name: file,
      content: await readFile(resolve(directory, file), 'utf8'),
    })),
  )
}

async function loadBrandIdBySlug(
  client: CuratedSyncClient,
  slugs: string[],
): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  for (const chunk of chunked([...new Set(slugs)], QUERY_CHUNK_SIZE)) {
    const { data, error } = await client
      .from('brands')
      .select('id, slug')
      .eq('status', 'approved')
      .in('slug', chunk)
    if (error) throw new Error(`failed to read brands: ${error.message}`)
    for (const row of (data ?? []) as { id: string; slug: string }[]) {
      map[row.slug] = row.id
    }
  }
  return map
}

/**
 * Revalidation config is checked BEFORE the first write, not after the last
 * one. The revalidate client warns and skips when it is unconfigured, which for
 * this script would mean a run that reports success while every touched brand
 * page keeps serving its hour-old shell. Failing here leaves the database
 * untouched, which is the reversible failure.
 */
function assertRevalidationConfigured(): void {
  const hasOrigin = Boolean(
    process.env.FORMORIA_RAILWAY_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim(),
  )
  const hasSecret = Boolean(process.env.ORIGIN_SECRET?.trim())
  if (hasOrigin && hasSecret) return

  throw new Error(
    '--apply requires ORIGIN_SECRET and FORMORIA_RAILWAY_URL (or NEXT_PUBLIC_SITE_URL): ' +
      'without them the write lands but every brand page keeps serving the stale ISR shell',
  )
}

function reportIssues(issues: NormalizeIssue[]): void {
  for (const issue of issues) {
    console.error(
      JSON.stringify({
        file: issue.file,
        productKey: issue.productKey,
        message: issue.message,
      }),
    )
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options.apply) assertRevalidationConfigured()

  const [productFiles, selectionFiles] = await Promise.all([
    loadContentFiles(PRODUCT_DIR),
    loadContentFiles(SELECTION_DIR),
  ])

  // The authored trail vocabulary is the set of selection files: one file per
  // trail. A `trail_slug` inside a file that disagrees with its own name is
  // then an error rather than a silently accepted new trail.
  const knownTrailSlugs = selectionFiles.map((file) =>
    file.name.replace(/\.ya?ml$/i, ''),
  )

  const content = normalizeCuratedContent({
    productFiles,
    selectionFiles,
    knownTrailSlugs,
  })
  reportIssues(content.issues)

  const filtered: CuratedSyncContent = options.brand
    ? {
        products: content.products.filter(
          (row) => row.brandSlug === options.brand,
        ),
        sources: content.sources.filter((row) => row.brandSlug === options.brand),
        selections: content.selections.filter(
          (row) => row.brandSlug === options.brand,
        ),
      }
    : content

  if (filtered.products.length === 0) {
    console.log(
      JSON.stringify({
        mode: options.apply ? 'apply' : 'dry-run',
        brand: options.brand,
        contentDir: CONTENT_DIR,
        products: 0,
        issues: content.issues.length,
        note: 'no authored curated products; nothing to plan',
      }),
    )
    if (options.apply && content.issues.length > 0) {
      throw new Error('refusing to apply content with unresolved issues')
    }
    return
  }

  if (options.apply && content.issues.length > 0) {
    throw new Error('refusing to apply content with unresolved issues')
  }

  const client = createServiceClient()
  const brandIdBySlug = await loadBrandIdBySlug(
    client,
    filtered.products.map((row) => row.brandSlug),
  )

  const result = await syncCuratedProducts({
    content: filtered,
    brandIdBySlug,
    apply: options.apply,
    client,
  })

  console.log(
    JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      brand: options.brand,
      totals: result.totals,
      operations: result.operations,
      unmatchedBrandSlugs: result.unmatchedBrandSlugs,
      images: {
        uploaded: result.images.filter((image) => image.action === 'uploaded')
          .length,
        reused: result.images.filter((image) => image.action === 'reused').length,
        skipped: result.images.filter((image) => image.action === 'skipped')
          .length,
      },
      affectedBrands: result.affectedBrandSlugs.length,
    }),
  )

  if (!options.apply || result.affectedBrandSlugs.length === 0) return

  const revalidation = await requestPublicBrandRevalidation(
    result.affectedBrandSlugs,
  )
  console.log(
    JSON.stringify({
      revalidated: result.affectedBrandSlugs.length,
      ok: revalidation.ok,
      reason: revalidation.reason ?? null,
    }),
  )
  if (!revalidation.ok) {
    // The rows are already committed, so this cannot be undone here — but it
    // must never be reported as a success: the pages are stale until someone
    // re-runs the revalidation.
    throw new Error(
      `revalidation failed (${revalidation.reason ?? 'unknown'}): brand pages are stale`,
    )
  }
}

// The test imports the exported functions, so importing this module must never
// start a run — under vitest argv[1] is the runner, not this file.
if (process.argv[1]?.endsWith('curated-products/run.ts')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
