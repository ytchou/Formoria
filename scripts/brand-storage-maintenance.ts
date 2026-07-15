import { randomUUID } from 'node:crypto'
import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'

import { processImage } from '@/lib/security/image-processor'
import { syncHeroDenormalized } from '@/lib/services/brand-images'
import { computeDHash } from '@/lib/services/image-download'

const BUCKET = 'brand-images'
const PAGE_SIZE = 1_000
const LIST_CONCURRENCY = 20
const REENCODE_CONCURRENCY = 4
const DELETE_CHUNK_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1_000
const SOAK_PROTECTION_MS = 7 * DAY_MS
const WEBP_SKIP_BYTES = 150 * 1024
const STORAGE_KEY_PREFIXES = ['brands/', 'submissions/'] as const
const ACTIVE_REENCODE_MANIFEST_PATTERN =
  /^\.reencode-originals-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z?\.json$/
const DEFAULT_PURGE_OPTIONS = {
  expectedRejected: 1_820,
  expectedUntracked: 2_056,
  tolerance: 0.15,
} as const

export type BucketObject = {
  path: string
  size: number
  contentType?: string | null
}

type ReencodeObject = {
  path: string
  size: number
  contentType: string | null
  jsonbReferenced: boolean
}

type ReencodeOptions = {
  webpSkipBytes: number
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

type BrandReencodeRow = {
  id: string
  brand_id: string
  storage_path: string | null
  url: string
}

type SubmissionReencodeRow = {
  id: string
  submission_id: string
  storage_path: string | null
  url: string
}

type ReencodeTarget = {
  id: string
  kind: 'brand' | 'submission'
  ownerId: string
  path: string
  oldUrl: string
  size: number
  contentType: string | null
}

type ReencodeFailure = {
  path: string
  message: string
}

export type ReencodeManifest = {
  file: string
  createdAt: Date
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

export function shouldReencode(
  object: ReencodeObject,
  options: ReencodeOptions,
): boolean {
  if (object.jsonbReferenced) return false

  const contentType = object.contentType?.split(';', 1)[0]?.trim().toLowerCase()
  const extension = path.extname(object.path).toLowerCase()
  if (contentType === 'image/gif' || extension === '.gif') return false

  const isWebp = contentType === 'image/webp' || extension === '.webp'
  return !isWebp || object.size >= options.webpSkipBytes
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
        const contentType =
          typeof entry.metadata?.mimetype === 'string'
            ? entry.metadata.mimetype
            : null
        objects.push({ path, size, contentType })
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

function reencodeManifestCreatedAt(manifest: ReencodeManifest): Date {
  const match = ACTIVE_REENCODE_MANIFEST_PATTERN.exec(manifest.file)
  if (!match) return manifest.createdAt
  const [, date, hour, minute, second, millisecond] = match
  if (!date || !hour || !minute || !second) return manifest.createdAt

  const timestamp = Date.parse(
    `${date}T${hour}:${minute}:${second}.${millisecond ?? '000'}Z`,
  )
  return Number.isNaN(timestamp) ? manifest.createdAt : new Date(timestamp)
}

export function selectPurgeableManifests(
  manifests: ReencodeManifest[],
  now: Date,
): ReencodeManifest[] {
  return manifests.filter(
    (manifest) =>
      now.getTime() - reencodeManifestCreatedAt(manifest).getTime() >=
      SOAK_PROTECTION_MS,
  )
}

async function listReencodeManifests(): Promise<ReencodeManifest[]> {
  const scriptsDirectory = 'scripts'
  const names = await readdir(scriptsDirectory)
  const manifestNames = names.filter((name) =>
    ACTIVE_REENCODE_MANIFEST_PATTERN.test(name),
  )

  return Promise.all(
    manifestNames.map(async (file) => {
      const fileStat = await stat(path.join(scriptsDirectory, file))
      return { file, createdAt: fileStat.mtime }
    }),
  )
}

async function loadReencodeManifestKeys(
  manifest: ReencodeManifest,
): Promise<string[]> {
  const manifestPath = path.join('scripts', manifest.file)
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const keys = new Set<string>()
    collectStorageKeys(JSON.parse(raw) as unknown, keys)
    return [...keys]
  } catch (error) {
    throw new Error(
      `Invalid re-encode manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function loadSoakProtectedPaths(): Promise<Set<string>> {
  const manifests = await listReencodeManifests()
  const purgeableFiles = new Set(
    selectPurgeableManifests(manifests, new Date()).map(
      (manifest) => manifest.file,
    ),
  )
  const keys = await Promise.all(
    manifests
      .filter((manifest) => !purgeableFiles.has(manifest.file))
      .map(loadReencodeManifestKeys),
  )

  return new Set(keys.flat())
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

async function purgeOriginals(live: boolean): Promise<void> {
  const now = new Date()
  const manifests = await listReencodeManifests()
  const purgeable = selectPurgeableManifests(manifests, now)
  const purgeableFiles = new Set(
    purgeable.map((manifest) => manifest.file),
  )

  for (const manifest of manifests) {
    if (purgeableFiles.has(manifest.file)) continue
    const ageMs = now.getTime() - reencodeManifestCreatedAt(manifest).getTime()
    const daysLeft = Math.max(
      0,
      Math.ceil((SOAK_PROTECTION_MS - ageMs) / DAY_MS),
    )
    console.log(`${manifest.file}: still soaking (${daysLeft} days left)`)
  }

  const loaded = await Promise.all(
    purgeable.map(async (manifest) => ({
      manifest,
      keys: await loadReencodeManifestKeys(manifest),
    })),
  )
  const keys = [...new Set(loaded.flatMap(({ keys: manifestKeys }) => manifestKeys))]

  console.table(
    loaded.flatMap(({ manifest, keys: manifestKeys }) =>
      manifestKeys.map((key) => ({ manifest: manifest.file, key })),
    ),
  )
  console.log(
    `Purge originals plan: ${keys.length} object(s) from ${purgeable.length} manifest(s).`,
  )

  if (!live) {
    console.log(
      'Dry run complete. Re-run with purge-originals --live to delete these objects.',
    )
    return
  }
  if (purgeable.length === 0) {
    console.log('No soaked originals are ready to purge.')
    return
  }

  const supabase = createServiceClient()
  const deleted = new Set(await removeObjects(supabase, keys))
  let consumed = 0

  for (const { manifest, keys: manifestKeys } of loaded) {
    if (!manifestKeys.every((key) => deleted.has(key))) {
      console.error(
        `Keeping ${manifest.file} because one or more objects failed to delete.`,
      )
      continue
    }

    const sourcePath = path.join('scripts', manifest.file)
    const donePath = sourcePath.replace(/\.json$/, '.done.json')
    await rename(sourcePath, donePath)
    consumed += 1
    console.log(`Consumed manifest: ${donePath}`)
  }

  console.log(`Deleted ${deleted.size} of ${keys.length} object(s).`)
  console.log(`Consumed ${consumed} of ${purgeable.length} manifest(s).`)
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

function contentTypeFromPath(storagePath: string): string | null {
  const extension = path.extname(storagePath).toLowerCase()
  const contentTypes: Record<string, string> = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }
  return contentTypes[extension] ?? null
}

function dominantColorToHex(dominant: {
  r: number
  g: number
  b: number
}): string {
  const toHex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(dominant.r)}${toHex(dominant.g)}${toHex(dominant.b)}`
}

function reencodeManifestPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join('scripts', `.reencode-originals-${timestamp}.json`)
}

async function createReencodeManifest(): Promise<{
  outputPath: string
  append: (storagePath: string) => Promise<void>
}> {
  const outputPath = reencodeManifestPath()
  const originals = new Set<string>()
  let pendingWrite = writeFile(outputPath, '[]\n', 'utf8')

  return {
    outputPath,
    append(storagePath: string) {
      originals.add(storagePath)
      const snapshot = [...originals]
      pendingWrite = pendingWrite.then(() =>
        writeFile(
          outputPath,
          `${JSON.stringify(snapshot, null, 2)}\n`,
          'utf8',
        ),
      )
      return pendingWrite
    },
  }
}

async function loadReencodeTargets(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<{ targets: ReencodeTarget[]; failures: ReencodeFailure[] }> {
  const [brandRows, submissionRows, brands, submissions, objects] =
    await Promise.all([
      fetchAllRows<BrandReencodeRow>('brand_images', (from, to) =>
        supabase
          .from('brand_images')
          .select('id, brand_id, storage_path, url')
          .eq('status', 'active')
          .not('storage_path', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<SubmissionReencodeRow>('submission_images', (from, to) =>
        supabase
          .from('submission_images')
          .select('id, submission_id, storage_path, url')
          .eq('status', 'active')
          .not('storage_path', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<Pick<BrandReferenceRow, 'draft_data'>>(
        'brands',
        (from, to) =>
          supabase
            .from('brands')
            .select('draft_data')
            .order('id', { ascending: true })
            .range(from, to),
      ),
      fetchAllRows<Pick<SubmissionReferenceRow, 'enriched_data'>>(
        'brand_submissions',
        (from, to) =>
          supabase
            .from('brand_submissions')
            .select('enriched_data')
            .order('id', { ascending: true })
            .range(from, to),
      ),
      listAllObjects(supabase),
    ])

  const jsonbReferencedPaths = new Set<string>()
  for (const brand of brands) {
    collectStorageKeys(brand.draft_data, jsonbReferencedPaths)
  }
  for (const submission of submissions) {
    collectStorageKeys(submission.enriched_data, jsonbReferencedPaths)
  }

  const objectsByPath = new Map(objects.map((object) => [object.path, object]))
  const failures: ReencodeFailure[] = []
  const targets: ReencodeTarget[] = []
  const rows = [
    ...brandRows.map((row) => ({
      ...row,
      kind: 'brand' as const,
      ownerId: row.brand_id,
    })),
    ...submissionRows.map((row) => ({
      ...row,
      kind: 'submission' as const,
      ownerId: row.submission_id,
    })),
  ]

  for (const row of rows) {
    if (!row.storage_path) continue
    const object = objectsByPath.get(row.storage_path)
    if (!object) {
      failures.push({
        path: row.storage_path,
        message: 'Active database row points to a missing storage object',
      })
      continue
    }

    const contentType =
      object.contentType ?? contentTypeFromPath(row.storage_path)
    if (
      !shouldReencode(
        {
          path: row.storage_path,
          size: object.size,
          contentType,
          jsonbReferenced: jsonbReferencedPaths.has(row.storage_path),
        },
        { webpSkipBytes: WEBP_SKIP_BYTES },
      )
    ) {
      continue
    }

    targets.push({
      id: row.id,
      kind: row.kind,
      ownerId: row.ownerId,
      path: row.storage_path,
      oldUrl: row.url,
      size: object.size,
      contentType,
    })
  }

  return { targets, failures }
}

async function reencodeTarget(
  supabase: ReturnType<typeof createServiceClient>,
  target: ReencodeTarget,
  appendOriginal: (storagePath: string) => Promise<void>,
): Promise<void> {
  const prefix = target.kind === 'brand' ? 'brands' : 'submissions'
  const newPath = `${prefix}/${target.ownerId}/${randomUUID()}.webp`
  let uploaded = false
  let rowUpdated = false

  try {
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(target.path)
    if (downloadError) throw downloadError
    if (!blob) throw new Error('Storage download returned no data')

    const inputBuffer = Buffer.from(await blob.arrayBuffer())
    const processed = await processImage(inputBuffer, {
      maxWidth: 1600,
      maxHeight: 1600,
      maxFileSizeBytes: 40 * 1024 * 1024,
    })
    const [phash, stats] = await Promise.all([
      computeDHash(processed.buffer),
      sharp(processed.buffer).stats(),
    ])
    const dominantColor = dominantColorToHex(stats.dominant)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, processed.buffer, {
        contentType: 'image/webp',
        cacheControl: '31536000',
      })
    if (uploadError) throw uploadError
    uploaded = true

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(newPath)

    await appendOriginal(target.path)

    const table = target.kind === 'brand' ? 'brand_images' : 'submission_images'
    const { error: updateError } = await supabase
      .from(table)
      .update({
        url: publicUrl,
        storage_path: newPath,
        width: processed.width,
        height: processed.height,
        phash,
        dominant_color: dominantColor,
      })
      .eq('id', target.id)
    if (updateError) throw updateError
    rowUpdated = true

    if (target.kind === 'submission') {
      const { error: heroUpdateError } = await supabase
        .from('brand_submissions')
        .update({ hero_image_url: publicUrl })
        .eq('id', target.ownerId)
        .eq('hero_image_url', target.oldUrl)
      if (heroUpdateError) throw heroUpdateError
    }
  } catch (error) {
    if (uploaded && !rowUpdated) {
      const { error: cleanupError } = await supabase.storage
        .from(BUCKET)
        .remove([newPath])
      if (cleanupError) {
        console.error(`Failed to clean up ${newPath}: ${cleanupError.message}`)
      }
    }
    throw error
  }
}

async function reencode(live: boolean): Promise<void> {
  if (live) {
    console.warn(
      'WARNING: Ensure the curation worker is idle before running reencode --live.',
    )
  }

  const supabase = createServiceClient()
  const { targets, failures } = await loadReencodeTargets(supabase)
  const estimatedBytes = targets.reduce((total, target) => total + target.size, 0)

  console.table(
    targets.map((target) => ({
      table: target.kind === 'brand' ? 'brand_images' : 'submission_images',
      id: target.id,
      storage_path: target.path,
      content_type: target.contentType,
      bytes: target.size,
    })),
  )
  console.log(
    `Reencode plan: ${targets.length} object(s), ${(estimatedBytes / 1024 / 1024).toFixed(2)} MB to download.`,
  )

  if (!live) {
    if (failures.length > 0) console.table(failures)
    console.log('Dry run complete. Re-run with --live to re-encode these objects.')
    return
  }
  if (targets.length === 0) {
    if (failures.length > 0) console.table(failures)
    if (failures.length > 0) {
      throw new Error(`Reencode completed with ${failures.length} failure(s)`)
    }
    console.log('No eligible objects to re-encode.')
    return
  }

  const manifest = await createReencodeManifest()
  let completed = 0
  for (let index = 0; index < targets.length; index += REENCODE_CONCURRENCY) {
    await Promise.all(
      targets.slice(index, index + REENCODE_CONCURRENCY).map(async (target) => {
        try {
          await reencodeTarget(supabase, target, manifest.append)
          completed += 1
        } catch (error) {
          failures.push({
            path: target.path,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }),
    )
  }

  const brandIds = new Set(
    targets
      .filter((target) => target.kind === 'brand')
      .map((target) => target.ownerId),
  )
  for (const brandId of brandIds) {
    try {
      await syncHeroDenormalized(supabase, brandId)
    } catch (error) {
      failures.push({
        path: `brand:${brandId}`,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  console.log(`Re-encoded ${completed} of ${targets.length} object(s).`)
  console.log(`Originals manifest: ${manifest.outputPath}`)
  if (failures.length > 0) {
    console.error(`Reencode failures (${failures.length}):`)
    console.table(failures)
    throw new Error(`Reencode completed with ${failures.length} failure(s)`)
  }
}

async function main(): Promise<void> {
  const subcommand = process.argv[2] ?? 'audit'
  const args = process.argv.slice(3)
  if (subcommand === 'audit' && args.length === 0) {
    await audit()
    return
  }
  if (
    (subcommand === 'purge' ||
      subcommand === 'purge-originals' ||
      subcommand === 'reencode') &&
    args.every((argument) => argument === '--live') &&
    args.filter((argument) => argument === '--live').length <= 1
  ) {
    if (subcommand === 'purge') {
      await purge(args.includes('--live'))
    } else if (subcommand === 'purge-originals') {
      await purgeOriginals(args.includes('--live'))
    } else {
      await reencode(args.includes('--live'))
    }
    return
  }
  if (
    subcommand !== 'audit' &&
    subcommand !== 'purge' &&
    subcommand !== 'purge-originals' &&
    subcommand !== 'reencode'
  ) {
    throw new Error(
      `Unknown subcommand "${subcommand}". Available subcommands: audit, purge [--live], purge-originals [--live], reencode [--live]`,
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
