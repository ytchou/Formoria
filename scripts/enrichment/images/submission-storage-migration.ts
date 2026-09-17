/**
 * @formoria-script
 * purpose: Audits, migrates, and restores submission images between the public and private buckets.
 * class: operator
 * invoke: pnpm submission-storage audit
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 */
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'

import { createClient } from '@supabase/supabase-js'

import {
  BRAND_IMAGES_BUCKET,
  BRAND_SUBMISSIONS_BUCKET,
  SUBMISSION_IMAGES_KEY_PREFIX,
} from '@/lib/images/storage-keys'
import { resolvePromotedKey } from '@/lib/images/submission-image-promotion'
import { artifactPath } from '../../shared/artifact'
import { loadScriptTarget } from '../../shared/target'

const PAGE_SIZE = 1_000
const FILE_SIZE_LIMIT = 10 * 1024 * 1024
const ALLOWED_MIME_TYPES = [
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/avif',
] as const

export type MigrationObject = {
  path: string
  size: number
  etag: string
}

export type MigrationRow = {
  table: 'brand_images' | 'submission_images'
  id: string
  status: string
  brandId: string | null
  storagePath: string
  storedPath?: string | null
  url: string
}

type MoveObject = {
  source: MigrationObject
  destination: MigrationObject | null
  action: 'copy' | 'adopt'
}

type Promotion = MigrationRow & {
  sourceKey: string
  targetKey: string
}

export type MigrationPlan = {
  moveObjects: MoveObject[]
  orphanKeys: string[]
  promotions: Promotion[]
  nullTombstones: MigrationRow[]
  blockers: string[]
}

export type ManifestRow = {
  table: MigrationRow['table']
  id: string
  before: { storagePath: string | null; url: string }
  after: { storagePath: string | null; url: string }
  mutationPlanned: boolean
}

export type MigrationManifest = {
  version: 1
  projectRef: string
  createdAt: string
  brandImagesWasPublic: boolean
  objects: Array<{
    key: string
    source: MigrationObject
    destinationExisted: boolean
    sourceDeletePlanned: boolean
  }>
  rows: ManifestRow[]
  promotedObjects: Array<{
    key: string
    destinationExisted: boolean
    createPlanned: boolean
  }>
}

export function verificationAction(
  source: MigrationObject,
  destination: MigrationObject | null,
): 'copy' | 'adopt' {
  if (source.size < 0 || source.etag.trim().length === 0) {
    throw new Error(`${source.path} cannot be verified: missing size or etag`)
  }
  if (destination === null) return 'copy'
  if (destination.size < 0 || destination.etag.trim().length === 0) {
    throw new Error(
      `${destination.path} cannot be verified: missing size or etag`,
    )
  }
  if (source.size !== destination.size || source.etag !== destination.etag) {
    throw new Error(
      `${destination.path} differs between source and destination`,
    )
  }
  return 'adopt'
}

export function planSubmissionStorageMigration(input: {
  publicObjects: readonly MigrationObject[]
  privateObjects: readonly MigrationObject[]
  rows: readonly MigrationRow[]
}): MigrationPlan {
  const publicByPath = new Map(
    input.publicObjects.map((object) => [object.path, object]),
  )
  const privateByPath = new Map(
    input.privateObjects.map((object) => [object.path, object]),
  )
  const referenced = new Set(input.rows.map((row) => row.storagePath))
  const plan: MigrationPlan = {
    moveObjects: [],
    orphanKeys: [],
    promotions: [],
    nullTombstones: [],
    blockers: [],
  }

  for (const source of [...input.publicObjects].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const destination = privateByPath.get(source.path) ?? null
    try {
      plan.moveObjects.push({
        source,
        destination,
        action: verificationAction(source, destination),
      })
    } catch (error) {
      plan.blockers.push(error instanceof Error ? error.message : String(error))
    }
    if (!referenced.has(source.path)) plan.orphanKeys.push(source.path)
  }

  for (const row of input.rows) {
    const hasObject =
      publicByPath.has(row.storagePath) || privateByPath.has(row.storagePath)
    if (row.status === 'rejected') {
      if (row.table === 'brand_images' || !hasObject)
        plan.nullTombstones.push(row)
      continue
    }
    if (row.table !== 'brand_images') {
      if (!hasObject)
        plan.blockers.push(
          `${row.table}:${row.id} references missing ${row.storagePath}`,
        )
      continue
    }
    if (!hasObject) {
      plan.blockers.push(
        `brand_images:${row.id} references missing ${row.storagePath}`,
      )
      continue
    }
    const targetKey = resolvePromotedKey(row.brandId, row.storagePath)
    if (!targetKey) {
      plan.blockers.push(
        `brand_images:${row.id} cannot derive a public destination`,
      )
      continue
    }
    plan.promotions.push({ ...row, sourceKey: row.storagePath, targetKey })
  }

  return plan
}

export function buildRestorePlan(manifest: MigrationManifest): {
  restorePublicObjects: string[]
  removeCreatedPublicObjects: string[]
  restoreRows: ManifestRow[]
} {
  return {
    restorePublicObjects: manifest.objects
      .filter((entry) => entry.sourceDeletePlanned)
      .map((entry) => entry.key),
    removeCreatedPublicObjects: manifest.promotedObjects
      .filter((entry) => entry.createPlanned && !entry.destinationExisted)
      .map((entry) => entry.key),
    restoreRows: manifest.rows.filter((entry) => entry.mutationPlanned),
  }
}

function createOperatorClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    )
  }
  return createClient(url, serviceRoleKey)
}

type OperatorClient = ReturnType<typeof createOperatorClient>
const STORAGE_READ_ATTEMPTS = 4

function isMissing(
  error: { message?: string; statusCode?: string | number } | null,
): boolean {
  return Boolean(
    error &&
    (String(error.statusCode) === '404' ||
      /not found|does not exist/i.test(error.message ?? '')),
  )
}

function isTransientStorageFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /fetch failed|timed? ?out|HTTP 5\d\d|status(?:Code)?[=: ]+5\d\d/i.test(
    message,
  )
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 500))
}

async function statObject(
  client: OperatorClient,
  bucket: string,
  objectPath: string,
): Promise<MigrationObject | null> {
  for (let attempt = 1; attempt <= STORAGE_READ_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await client.storage.from(bucket).info(objectPath)
      if (error) {
        if (isMissing(error)) return null
        throw new Error(
          `Failed to stat ${bucket}/${objectPath}: ${error.message}`,
        )
      }
      if (
        typeof data.size !== 'number' ||
        typeof data.etag !== 'string' ||
        !data.etag
      ) {
        throw new Error(
          `${bucket}/${objectPath} cannot be verified: missing size or etag`,
        )
      }
      return { path: objectPath, size: data.size, etag: data.etag }
    } catch (error) {
      if (
        attempt === STORAGE_READ_ATTEMPTS ||
        !isTransientStorageFailure(error)
      ) {
        throw error
      }
      await retryDelay(attempt)
    }
  }
  throw new Error(`Failed to stat ${bucket}/${objectPath}`)
}

async function listPrefix(
  client: OperatorClient,
  bucket: string,
  prefix: string,
): Promise<MigrationObject[]> {
  const objects: MigrationObject[] = []
  const folders: string[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error)
      throw new Error(`Failed to list ${bucket}/${prefix}: ${error.message}`)
    const page = data ?? []
    if (page.length === 0) break
    offset += page.length
    for (const entry of page) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) folders.push(objectPath)
      else {
        const object = await statObject(client, bucket, objectPath)
        if (!object)
          throw new Error(`${bucket}/${objectPath} vanished during inventory`)
        objects.push(object)
      }
    }
  }
  for (const folder of folders)
    objects.push(...(await listPrefix(client, bucket, folder)))
  return objects
}

async function bucketState(
  client: OperatorClient,
  bucket: string,
): Promise<{ exists: boolean; public: boolean }> {
  const { data, error } = await client.storage.getBucket(bucket)
  if (error) {
    if (isMissing(error)) return { exists: false, public: false }
    throw new Error(`Failed to inspect ${bucket}: ${error.message}`)
  }
  return { exists: true, public: data.public }
}

async function ensurePrivateBucket(client: OperatorClient): Promise<void> {
  const state = await bucketState(client, BRAND_SUBMISSIONS_BUCKET)
  const options = {
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES],
  }
  const result = state.exists
    ? await client.storage.updateBucket(BRAND_SUBMISSIONS_BUCKET, options)
    : await client.storage.createBucket(BRAND_SUBMISSIONS_BUCKET, options)
  if (result.error) {
    throw new Error(
      `Failed to ensure private ${BRAND_SUBMISSIONS_BUCKET}: ${result.error.message}`,
    )
  }
  const verified = await bucketState(client, BRAND_SUBMISSIONS_BUCKET)
  if (!verified.exists || verified.public) {
    throw new Error(
      `${BRAND_SUBMISSIONS_BUCKET} is missing or public after configuration`,
    )
  }
}

async function fetchRows(client: OperatorClient): Promise<MigrationRow[]> {
  const rows: MigrationRow[] = []
  for (const table of ['brand_images', 'submission_images'] as const) {
    let from = 0
    for (;;) {
      const select =
        table === 'brand_images'
          ? 'id, status, brand_id, storage_path, url'
          : 'id, status, storage_path, url'
      const { data, error } = await client
        .from(table)
        .select(select)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(`Failed to read ${table}: ${error.message}`)
      const page = (data ?? []) as unknown as Array<{
        id: string
        status: string
        brand_id?: string | null
        storage_path: string | null
        url: string
      }>
      for (const row of page) {
        const storagePath = submissionKey(row.storage_path, row.url)
        if (!storagePath) continue
        rows.push({
          table,
          id: row.id,
          status: row.status,
          brandId: row.brand_id ?? null,
          storagePath,
          storedPath: row.storage_path,
          url: row.url,
        })
      }
      if (page.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
  }
  return rows
}

function submissionKey(storagePath: string | null, url: string): string | null {
  const stored = storagePath?.trim()
  if (stored?.startsWith(SUBMISSION_IMAGES_KEY_PREFIX)) return stored
  const proxyMarker = `/i/${SUBMISSION_IMAGES_KEY_PREFIX}`
  const publicMarker = `/storage/v1/object/public/${BRAND_IMAGES_BUCKET}/${SUBMISSION_IMAGES_KEY_PREFIX}`
  for (const marker of [proxyMarker, publicMarker]) {
    const markerIndex = url.indexOf(marker)
    if (markerIndex >= 0) {
      const key = url.slice(markerIndex + marker.length)
      if (key && !key.includes('..'))
        return `${SUBMISSION_IMAGES_KEY_PREFIX}${key}`
    }
  }
  return null
}

async function inventory(client: OperatorClient): Promise<{
  publicObjects: MigrationObject[]
  privateObjects: MigrationObject[]
  rows: MigrationRow[]
  brandImagesPublic: boolean
  brandSubmissionsExists: boolean
  brandSubmissionsPublic: boolean
}> {
  const [publicState, privateState, publicObjects, rows] = await Promise.all([
    bucketState(client, BRAND_IMAGES_BUCKET),
    bucketState(client, BRAND_SUBMISSIONS_BUCKET),
    listPrefix(
      client,
      BRAND_IMAGES_BUCKET,
      SUBMISSION_IMAGES_KEY_PREFIX.slice(0, -1),
    ),
    fetchRows(client),
  ])
  if (!publicState.exists)
    throw new Error(`${BRAND_IMAGES_BUCKET} does not exist`)
  const privateObjects = privateState.exists
    ? await listPrefix(
        client,
        BRAND_SUBMISSIONS_BUCKET,
        SUBMISSION_IMAGES_KEY_PREFIX.slice(0, -1),
      )
    : []
  return {
    publicObjects,
    privateObjects,
    rows,
    brandImagesPublic: publicState.public,
    brandSubmissionsExists: privateState.exists,
    brandSubmissionsPublic: privateState.public,
  }
}

function printInventory(current: Awaited<ReturnType<typeof inventory>>): void {
  console.table([
    {
      bucket: BRAND_IMAGES_BUCKET,
      exists: true,
      public: current.brandImagesPublic,
      submissionObjects: current.publicObjects.length,
    },
    {
      bucket: BRAND_SUBMISSIONS_BUCKET,
      exists: current.brandSubmissionsExists,
      public: current.brandSubmissionsPublic,
      submissionObjects: current.privateObjects.length,
    },
  ])
}

function printPlan(plan: MigrationPlan): void {
  console.table([
    { item: 'public submission objects', count: plan.moveObjects.length },
    { item: 'orphaned objects', count: plan.orphanKeys.length },
    { item: 'brand row promotions', count: plan.promotions.length },
    { item: 'rejected paths to null', count: plan.nullTombstones.length },
    { item: 'blockers', count: plan.blockers.length },
  ])
  for (const blocker of plan.blockers) console.error(`BLOCKER: ${blocker}`)
}

async function durableWrite(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  const handle = await open(temporary, 'w')
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, file)
  const directory = await open(path.dirname(file), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function copyObject(
  client: OperatorClient,
  sourceBucket: string,
  destinationBucket: string,
  sourceKey: string,
  destinationKey: string,
): Promise<void> {
  const { error } = await client.storage
    .from(sourceBucket)
    .copy(sourceKey, destinationKey, { destinationBucket })
  if (error) {
    throw new Error(
      `Failed to copy ${sourceBucket}/${sourceKey} to ${destinationBucket}/${destinationKey}: ${error.message}`,
    )
  }
}

function publicUrl(key: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${BRAND_IMAGES_BUCKET}/${key}`
}

async function applyMigration(
  client: OperatorClient,
  projectRef: string,
  current: Awaited<ReturnType<typeof inventory>>,
  plan: MigrationPlan,
): Promise<string> {
  if (plan.blockers.length > 0)
    throw new Error('Migration blocked by inventory errors')
  await ensurePrivateBucket(client)

  const manifest: MigrationManifest = {
    version: 1,
    projectRef,
    createdAt: new Date().toISOString(),
    brandImagesWasPublic: current.brandImagesPublic,
    objects: plan.moveObjects.map((entry) => ({
      key: entry.source.path,
      source: entry.source,
      destinationExisted: entry.destination !== null,
      sourceDeletePlanned: false,
    })),
    rows: [
      ...plan.promotions.map((row) => ({
        table: row.table,
        id: row.id,
        before: {
          storagePath:
            row.storedPath === undefined ? row.storagePath : row.storedPath,
          url: row.url,
        },
        after: { storagePath: row.targetKey, url: publicUrl(row.targetKey) },
        mutationPlanned: false,
      })),
      ...plan.nullTombstones.map((row) => ({
        table: row.table,
        id: row.id,
        before: {
          storagePath:
            row.storedPath === undefined ? row.storagePath : row.storedPath,
          url: row.url,
        },
        after: { storagePath: null, url: row.url },
        mutationPlanned: false,
      })),
    ],
    promotedObjects: [],
  }
  const manifestPath = artifactPath('submission-storage-rollback', {
    prefix: '',
    ext: 'json',
    suffix: process.pid,
  })
  await durableWrite(manifestPath, manifest)
  console.log(`Rollback manifest initialized: ${manifestPath}`)

  for (const entry of plan.moveObjects) {
    if (entry.action === 'copy') {
      await copyObject(
        client,
        BRAND_IMAGES_BUCKET,
        BRAND_SUBMISSIONS_BUCKET,
        entry.source.path,
        entry.source.path,
      )
    }
    const destination = await statObject(
      client,
      BRAND_SUBMISSIONS_BUCKET,
      entry.source.path,
    )
    verificationAction(entry.source, destination)
    const manifestEntry = manifest.objects.find(
      (item) => item.key === entry.source.path,
    )
    if (!manifestEntry)
      throw new Error(`Manifest entry missing for ${entry.source.path}`)
    manifestEntry.sourceDeletePlanned = true
    await durableWrite(manifestPath, manifest)
    const { error } = await client.storage
      .from(BRAND_IMAGES_BUCKET)
      .remove([entry.source.path])
    if (error)
      throw new Error(`Failed to delete ${entry.source.path}: ${error.message}`)
    if (await statObject(client, BRAND_IMAGES_BUCKET, entry.source.path)) {
      throw new Error(`Source still exists after delete: ${entry.source.path}`)
    }
  }

  for (const promotion of plan.promotions) {
    const source = await statObject(
      client,
      BRAND_SUBMISSIONS_BUCKET,
      promotion.sourceKey,
    )
    if (!source)
      throw new Error(`Missing private source ${promotion.sourceKey}`)
    const destination = await statObject(
      client,
      BRAND_IMAGES_BUCKET,
      promotion.targetKey,
    )
    const action = verificationAction(source, destination)
    const promotedEntry = {
      key: promotion.targetKey,
      destinationExisted: destination !== null,
      createPlanned: action === 'copy',
    }
    manifest.promotedObjects.push(promotedEntry)
    await durableWrite(manifestPath, manifest)
    if (action === 'copy') {
      await copyObject(
        client,
        BRAND_SUBMISSIONS_BUCKET,
        BRAND_IMAGES_BUCKET,
        promotion.sourceKey,
        promotion.targetKey,
      )
    }
    verificationAction(
      source,
      await statObject(client, BRAND_IMAGES_BUCKET, promotion.targetKey),
    )
    const row = manifest.rows.find(
      (item) => item.table === promotion.table && item.id === promotion.id,
    )
    if (!row)
      throw new Error(
        `Manifest row missing for ${promotion.table}:${promotion.id}`,
      )
    row.mutationPlanned = true
    await durableWrite(manifestPath, manifest)
    const update = client
      .from(promotion.table)
      .update({ storage_path: row.after.storagePath, url: row.after.url })
      .eq('id', promotion.id)
    const { error } =
      promotion.storedPath === null
        ? await update.is('storage_path', null)
        : await update.eq(
            'storage_path',
            promotion.storedPath ?? promotion.storagePath,
          )
    if (error)
      throw new Error(
        `Failed to update ${promotion.table}:${promotion.id}: ${error.message}`,
      )
  }

  for (const tombstone of plan.nullTombstones) {
    const row = manifest.rows.find(
      (item) => item.table === tombstone.table && item.id === tombstone.id,
    )
    if (!row)
      throw new Error(
        `Manifest row missing for ${tombstone.table}:${tombstone.id}`,
      )
    row.mutationPlanned = true
    await durableWrite(manifestPath, manifest)
    const update = client
      .from(tombstone.table)
      .update({ storage_path: null })
      .eq('id', tombstone.id)
    const { error } =
      tombstone.storedPath === null
        ? await update.is('storage_path', null)
        : await update.eq(
            'storage_path',
            tombstone.storedPath ?? tombstone.storagePath,
          )
    if (error)
      throw new Error(
        `Failed to null ${tombstone.table}:${tombstone.id}: ${error.message}`,
      )
  }

  const residue = await inventory(client)
  if (
    residue.publicObjects.length > 0 ||
    residue.rows.some(
      (row) =>
        row.table === 'brand_images' &&
        (row.status !== 'rejected' || row.storedPath !== null),
    )
  ) {
    throw new Error(
      'Migration left public object or brand_images submission-key residue',
    )
  }
  return manifestPath
}

async function restore(
  client: OperatorClient,
  manifestPath: string,
  projectRef: string,
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as MigrationManifest
  if (manifest.version !== 1 || manifest.projectRef !== projectRef) {
    throw new Error(
      'Manifest version or project ref does not match the selected target',
    )
  }
  const privateState = await bucketState(client, BRAND_SUBMISSIONS_BUCKET)
  if (!privateState.exists || privateState.public) {
    throw new Error(
      `${BRAND_SUBMISSIONS_BUCKET} must exist and remain private for restore`,
    )
  }
  const { error: privateError } = await client.storage.updateBucket(
    BRAND_IMAGES_BUCKET,
    {
      public: false,
    },
  )
  if (privateError)
    throw new Error(
      `Failed to make brand-images private: ${privateError.message}`,
    )

  const plan = buildRestorePlan(manifest)
  for (const key of plan.restorePublicObjects) {
    const source = await statObject(client, BRAND_SUBMISSIONS_BUCKET, key)
    if (!source) throw new Error(`Cannot restore missing private object ${key}`)
    const destination = await statObject(client, BRAND_IMAGES_BUCKET, key)
    const action = verificationAction(source, destination)
    if (action === 'copy') {
      await copyObject(
        client,
        BRAND_SUBMISSIONS_BUCKET,
        BRAND_IMAGES_BUCKET,
        key,
        key,
      )
    }
    verificationAction(
      source,
      await statObject(client, BRAND_IMAGES_BUCKET, key),
    )
  }
  for (const row of plan.restoreRows) {
    const { error } = await client
      .from(row.table)
      .update({ storage_path: row.before.storagePath, url: row.before.url })
      .eq('id', row.id)
    if (error)
      throw new Error(
        `Failed to restore ${row.table}:${row.id}: ${error.message}`,
      )
  }
  for (const key of plan.removeCreatedPublicObjects) {
    const { error } = await client.storage
      .from(BRAND_IMAGES_BUCKET)
      .remove([key])
    if (error && !isMissing(error))
      throw new Error(`Failed to remove ${key}: ${error.message}`)
  }
}

function valueOf(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`
  return (
    argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) ?? null
  )
}

async function main(): Promise<void> {
  const { argv, projectRef } = loadScriptTarget()
  const command = argv[0] ?? 'audit'
  const client = createOperatorClient()

  if (command === 'audit' && (argv.length === 1 || argv.length === 0)) {
    const current = await inventory(client)
    printInventory(current)
    printPlan(planSubmissionStorageMigration(current))
    return
  }

  const apply = argv.includes('--apply')
  const confirmation = valueOf(argv, 'confirm-project')
  if (!apply || confirmation !== projectRef) {
    throw new Error(`Writes require --apply --confirm-project=${projectRef}`)
  }

  if (command === 'migrate') {
    const current = await inventory(client)
    const plan = planSubmissionStorageMigration(current)
    printInventory(current)
    printPlan(plan)
    const manifest = await applyMigration(client, projectRef, current, plan)
    console.log(`Migration complete. Rollback manifest: ${manifest}`)
    return
  }
  if (command === 'restore') {
    const manifest = valueOf(argv, 'manifest')
    if (!manifest) throw new Error('restore requires --manifest=<path>')
    await restore(client, manifest, projectRef)
    console.log(`Restore complete. ${BRAND_IMAGES_BUCKET} remains private.`)
    return
  }
  throw new Error(
    'Usage: [audit] | migrate --apply --confirm-project=<ref> | restore --apply --manifest=<path> --confirm-project=<ref>',
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
