import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'brand-images'
const PAGE_SIZE = 1_000
const LIST_CONCURRENCY = 20
const DELETE_CHUNK_SIZE = 100
const SOAK_PROTECTION_MS = 7 * 24 * 60 * 60 * 1_000
const STORAGE_KEY_PREFIXES = ['brands/', 'submissions/'] as const
const DEFAULT_PURGE_OPTIONS = {
  expectedRejected: 1_820,
  expectedUntracked: 2_056,
  tolerance: 0.15,
} as const

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

export type CategorizedObjects = {
  protected: BucketObject[]
  anomalies: BucketObject[]
  live: BucketObject[]
  rejected: BucketObject[]
  untracked: BucketObject[]
}

type PurgeCategory = 'rejected' | 'untracked'

type PurgeManifestEntry = {
  key: string
  category: PurgeCategory
  size: number
}

type PurgeOptions = {
  expectedRejected: number
  expectedUntracked: number
  tolerance: number
}

type PurgePlan = {
  entries: PurgeManifestEntry[]
  toDelete: string[]
  withinSanityGate: boolean
}

type ImageReferenceRow = {
  storage_path: string | null
  url: string | null
  status: string
}

type BrandImageStorageRow = {
  id: string
  storage_path: string | null
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

export function planPurge(
  categorized: CategorizedObjects,
  options: PurgeOptions,
): PurgePlan {
  const entries: PurgeManifestEntry[] = [
    ...categorized.rejected.map((object) => ({
      key: object.path,
      category: 'rejected' as const,
      size: object.size,
    })),
    ...categorized.untracked.map((object) => ({
      key: object.path,
      category: 'untracked' as const,
      size: object.size,
    })),
  ]
  const rejectedWithinTolerance =
    Math.abs(categorized.rejected.length - options.expectedRejected) <=
    options.expectedRejected * options.tolerance
  const untrackedWithinTolerance =
    Math.abs(categorized.untracked.length - options.expectedUntracked) <=
    options.expectedUntracked * options.tolerance

  return {
    entries,
    toDelete: entries.map((entry) => entry.key),
    withinSanityGate:
      rejectedWithinTolerance && untrackedWithinTolerance,
  }
}

function collectStorageKeys(value: unknown, keys: Set<string>): void {
  if (typeof value === 'string') {
    const key = isStorageKey(value) ? value : storageKeyFromPublicUrl(value)
    if (key) keys.add(key)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStorageKeys(item, keys)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectStorageKeys(item, keys)
  }
}

async function loadSoakProtectedPaths(): Promise<Set<string>> {
  const scriptsDirectory = 'scripts'
  const names = await readdir(scriptsDirectory)
  const manifestNames = names.filter((name) =>
    /^\.reencode-originals-.*\.json$/.test(name),
  )
  const now = Date.now()
  const manifests = await Promise.all(
    manifestNames.map(async (name) => {
      const manifestPath = path.join(scriptsDirectory, name)
      const fileStat = await stat(manifestPath)
      if (now - fileStat.mtimeMs >= SOAK_PROTECTION_MS) return null
      return {
        manifestPath,
        raw: await readFile(manifestPath, 'utf8'),
      }
    }),
  )
  const keys = new Set<string>()

  for (const manifest of manifests) {
    if (!manifest) continue
    try {
      collectStorageKeys(JSON.parse(manifest.raw) as unknown, keys)
    } catch (error) {
      throw new Error(
        `Invalid re-encode manifest ${manifest.manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return keys
}

function sizeInMb(objects: BucketObject[]): string {
  const bytes = objects.reduce((total, object) => total + object.size, 0)
  return (bytes / 1024 / 1024).toFixed(2)
}

type AuditResult = {
  supabase: ReturnType<typeof createServiceClient>
  objects: BucketObject[]
  categorized: CategorizedObjects
}

async function audit(): Promise<AuditResult> {
  const supabase = createServiceClient()
  const [objects, refs, soakProtectedPaths] = await Promise.all([
    listAllObjects(supabase),
    buildReferenceSet(supabase),
    loadSoakProtectedPaths(),
  ])
  refs.soakProtectedPaths = soakProtectedPaths
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

  return { supabase, objects, categorized }
}

function purgeManifestPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(
    'scripts',
    `.storage-purge-manifest-${timestamp}.json`,
  )
}

async function writePurgeManifest(
  entries: PurgeManifestEntry[],
): Promise<string> {
  const outputPath = purgeManifestPath()
  await writeFile(
    outputPath,
    `${JSON.stringify(entries, null, 2)}\n`,
    'utf8',
  )
  return outputPath
}

async function removeObjects(
  supabase: ReturnType<typeof createServiceClient>,
  keys: string[],
): Promise<string[]> {
  const deleted: string[] = []

  for (let index = 0; index < keys.length; index += DELETE_CHUNK_SIZE) {
    const chunk = keys.slice(index, index + DELETE_CHUNK_SIZE)
    try {
      const { error } = await supabase.storage.from(BUCKET).remove(chunk)
      if (error) throw error
      deleted.push(...chunk)
    } catch (error) {
      console.error(
        `Failed to delete storage chunk ${index / DELETE_CHUNK_SIZE + 1}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  return deleted
}

async function clearRejectedBrandImagePaths(
  supabase: ReturnType<typeof createServiceClient>,
  paths: string[],
): Promise<void> {
  for (let index = 0; index < paths.length; index += DELETE_CHUNK_SIZE) {
    const chunk = paths.slice(index, index + DELETE_CHUNK_SIZE)
    const { error } = await supabase
      .from('brand_images')
      .update({ storage_path: null })
      .eq('status', 'rejected')
      .in('storage_path', chunk)
    if (error) {
      throw new Error(
        `Failed to clear rejected brand_images storage paths: ${error.message}`,
      )
    }
  }
}

async function fixDanglingBrandImageRows(
  supabase: ReturnType<typeof createServiceClient>,
  existingObjectPaths: Set<string>,
): Promise<number> {
  const rows = await fetchAllRows<BrandImageStorageRow>(
    'brand_images',
    (from, to) =>
      supabase
        .from('brand_images')
        .select('id, storage_path')
        .order('id', { ascending: true })
        .range(from, to),
  )
  const danglingIds = rows.flatMap((row) =>
    row.storage_path && !existingObjectPaths.has(row.storage_path)
      ? [row.id]
      : [],
  )

  for (
    let index = 0;
    index < danglingIds.length;
    index += DELETE_CHUNK_SIZE
  ) {
    const chunk = danglingIds.slice(index, index + DELETE_CHUNK_SIZE)
    const { error } = await supabase
      .from('brand_images')
      .update({ status: 'rejected', storage_path: null })
      .in('id', chunk)
    if (error) {
      throw new Error(`Failed to fix dangling brand_images row: ${error.message}`)
    }
  }

  return danglingIds.length
}

async function purge(live: boolean): Promise<void> {
  const { supabase, objects, categorized } = await audit()
  const plan = planPurge(categorized, DEFAULT_PURGE_OPTIONS)
  const manifestPath = await writePurgeManifest(plan.entries)

  console.log(
    `\nPurge plan: ${categorized.rejected.length} rejected + ${categorized.untracked.length} untracked = ${plan.toDelete.length} objects`,
  )
  console.log(`Sanity gate: ${plan.withinSanityGate ? 'pass' : 'fail'}`)
  console.log(`Manifest: ${manifestPath}`)

  if (!live) {
    console.log('Dry run complete. Re-run with --live to delete these objects.')
    return
  }
  if (!plan.withinSanityGate) {
    throw new Error('Purge aborted: object counts failed the sanity gate')
  }

  const deletedPaths = await removeObjects(supabase, plan.toDelete)
  const rejectedPaths = new Set(
    categorized.rejected.map((object) => object.path),
  )
  await clearRejectedBrandImagePaths(
    supabase,
    deletedPaths.filter((key) => rejectedPaths.has(key)),
  )
  const danglingRowsFixed = await fixDanglingBrandImageRows(
    supabase,
    new Set(objects.map((object) => object.path)),
  )

  console.log(`Deleted ${deletedPaths.length} of ${plan.toDelete.length} objects.`)
  console.log(`Fixed ${danglingRowsFixed} dangling brand_images row(s).`)
}

async function main(): Promise<void> {
  const subcommand = process.argv[2] ?? 'audit'
  const args = process.argv.slice(3)
  if (subcommand === 'audit' && args.length === 0) {
    await audit()
    return
  }
  if (
    subcommand === 'purge' &&
    args.every((argument) => argument === '--live') &&
    args.filter((argument) => argument === '--live').length <= 1
  ) {
    await purge(args.includes('--live'))
    return
  }
  if (subcommand !== 'audit' && subcommand !== 'purge') {
    throw new Error(
      `Unknown subcommand "${subcommand}". Available subcommands: audit, purge [--live]`,
    )
  }

  throw new Error(`Invalid arguments for ${subcommand}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
