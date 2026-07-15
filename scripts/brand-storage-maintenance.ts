import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'brand-images'
const PAGE_SIZE = 1_000
const LIST_CONCURRENCY = 20
const STORAGE_KEY_PREFIXES = ['brands/', 'submissions/'] as const

export type BucketObject = {
  path: string
  size: number
}

export type StorageReferences = {
  activePaths: Set<string>
  rejectedPaths: Set<string>
  otherReferencedPaths: Set<string>
  soakProtectedPaths: Set<string>
}

type CategorizedObjects = {
  protected: BucketObject[]
  anomalies: BucketObject[]
  live: BucketObject[]
  rejected: BucketObject[]
  untracked: BucketObject[]
}

type ImageReferenceRow = {
  storage_path: string | null
  url: string | null
  status: string
}

type BrandReferenceRow = {
  hero_image_url: string | null
  draft_data: unknown
}

type SubmissionReferenceRow = {
  hero_image_url: string | null
  enriched_data: unknown
}

type QueryError = {
  message: string
}

type PageResult = {
  data: unknown[] | null
  error: QueryError | null
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  }
  if (!serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY; this maintenance script requires a service role key',
    )
  }

  return createSupabaseClient(url, serviceRoleKey)
}

function isStorageKey(value: string): boolean {
  return STORAGE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function storageKeyFromPublicUrl(url: string): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return null

  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`
  if (!url.startsWith(publicPrefix)) return null

  const key = url.slice(publicPrefix.length)
  return key && isStorageKey(key) ? key : null
}

function storageKeyFromReference(
  path: string | null,
  url: string | null,
): string | null {
  if (path && isStorageKey(path)) return path
  return url ? storageKeyFromPublicUrl(url) : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function storageKeysFromJson(value: unknown): string[] {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl || value === null || value === undefined) return []

  const prefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`
  const matches = JSON.stringify(value).match(
    new RegExp(`${escapeRegExp(prefix)}[^"]+`, 'g'),
  )

  return (matches ?? []).flatMap((url) => {
    const key = storageKeyFromPublicUrl(url)
    return key ? [key] : []
  })
}

async function fetchAllRows<T>(
  table: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<T[]> {
  const rows: T[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`${table} query failed: ${error.message}`)

    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows
}

async function listPrefix(
  supabase: ReturnType<typeof createServiceClient>,
  prefix: string,
): Promise<BucketObject[]> {
  const objects: BucketObject[] = []
  const folders: string[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) {
      throw new Error(
        `Storage list failed for "${prefix || '/'}": ${error.message}`,
      )
    }

    const page = data ?? []
    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) {
        folders.push(path)
      } else {
        const size =
          typeof entry.metadata?.size === 'number' ? entry.metadata.size : 0
        objects.push({ path, size })
      }
    }

    if (page.length < PAGE_SIZE) break
  }

  const uniqueFolders = [...new Set(folders)]
  for (let index = 0; index < uniqueFolders.length; index += LIST_CONCURRENCY) {
    const nestedObjects = await Promise.all(
      uniqueFolders
        .slice(index, index + LIST_CONCURRENCY)
        .map((folder) => listPrefix(supabase, folder)),
    )
    objects.push(...nestedObjects.flat())
  }

  return objects
}

export async function listAllObjects(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<BucketObject[]> {
  return listPrefix(supabase, '')
}

export async function buildReferenceSet(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<StorageReferences> {
  const [brandImages, submissionImages, brands, submissions] =
    await Promise.all([
      fetchAllRows<ImageReferenceRow>('brand_images', (from, to) =>
        supabase
          .from('brand_images')
          .select('storage_path, url, status')
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<ImageReferenceRow>('submission_images', (from, to) =>
        supabase
          .from('submission_images')
          .select('storage_path, url, status')
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<BrandReferenceRow>('brands', (from, to) =>
        supabase
          .from('brands')
          .select('hero_image_url, draft_data')
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<SubmissionReferenceRow>('brand_submissions', (from, to) =>
        supabase
          .from('brand_submissions')
          .select('hero_image_url, enriched_data')
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ])

  const activePaths = new Set<string>()
  const rejectedPaths = new Set<string>()
  const otherReferencedPaths = new Set<string>()

  for (const row of [...brandImages, ...submissionImages]) {
    const key = storageKeyFromReference(row.storage_path, row.url)
    if (!key) continue

    if (row.status === 'active') activePaths.add(key)
    if (row.status === 'rejected') rejectedPaths.add(key)
  }

  for (const brand of brands) {
    const heroKey = brand.hero_image_url
      ? storageKeyFromPublicUrl(brand.hero_image_url)
      : null
    if (heroKey) otherReferencedPaths.add(heroKey)
    for (const key of storageKeysFromJson(brand.draft_data)) {
      otherReferencedPaths.add(key)
    }
  }

  for (const submission of submissions) {
    const heroKey = submission.hero_image_url
      ? storageKeyFromPublicUrl(submission.hero_image_url)
      : null
    if (heroKey) otherReferencedPaths.add(heroKey)
    for (const key of storageKeysFromJson(submission.enriched_data)) {
      otherReferencedPaths.add(key)
    }
  }

  return {
    activePaths,
    rejectedPaths,
    otherReferencedPaths,
    soakProtectedPaths: new Set(),
  }
}

export function categorizeObjects(
  objects: BucketObject[],
  refs: StorageReferences,
): CategorizedObjects {
  const result: CategorizedObjects = {
    protected: [],
    anomalies: [],
    live: [],
    rejected: [],
    untracked: [],
  }

  for (const object of objects) {
    const { path } = object
    if (refs.soakProtectedPaths.has(path)) {
      result.protected.push(object)
    } else if (
      refs.rejectedPaths.has(path) &&
      refs.otherReferencedPaths.has(path)
    ) {
      result.anomalies.push(object)
    } else if (refs.otherReferencedPaths.has(path)) {
      result.protected.push(object)
    } else if (refs.activePaths.has(path)) {
      result.live.push(object)
    } else if (refs.rejectedPaths.has(path)) {
      result.rejected.push(object)
    } else {
      result.untracked.push(object)
    }
  }

  return result
}

function sizeInMb(objects: BucketObject[]): string {
  const bytes = objects.reduce((total, object) => total + object.size, 0)
  return (bytes / 1024 / 1024).toFixed(2)
}

async function audit(): Promise<void> {
  const supabase = createServiceClient()
  const [objects, refs] = await Promise.all([
    listAllObjects(supabase),
    buildReferenceSet(supabase),
  ])
  const categorized = categorizeObjects(objects, refs)

  console.table(
    Object.entries(categorized).map(([category, categoryObjects]) => ({
      category,
      count: categoryObjects.length,
      MB: sizeInMb(categoryObjects),
    })),
  )

  console.log('\nAnomalies (protected from deletion):')
  if (categorized.anomalies.length === 0) {
    console.log('  (none)')
  } else {
    for (const object of categorized.anomalies) {
      console.log(`- ${object.path}`)
    }
  }
}

async function main(): Promise<void> {
  const subcommand = process.argv[2] ?? 'audit'
  if (subcommand !== 'audit') {
    throw new Error(
      `Unknown subcommand "${subcommand}". Available subcommands: audit`,
    )
  }

  await audit()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
