import { createServiceClient } from '@/lib/supabase/server'
import { auditedCall } from '@/lib/audit'
import { uploadWithRetry } from './storage-retry'

const BRAND_IMAGES_BUCKET = 'brand-images'
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const DEFAULT_BATCH_SIZE = 100
const MAX_BATCH_SIZE = 1_000
const STORAGE_DELETE_BATCH_SIZE = 100

const RETENTION_TABLES = ['brand_images', 'submission_images'] as const
type RetentionTable = (typeof RETENTION_TABLES)[number]

type RetentionRow = {
  id: string
  storage_path: string
  rejected_at: string
}

type RetentionError = {
  table: RetentionTable
  id: string
  message: string
}

export type PurgeClassifierJunkOptions = {
  now?: Date
  batchSize?: number
}

export type PurgeClassifierJunkSummary = {
  cutoff: string
  selected: number
  storageDeleted: number
  rowsCleared: number
  failed: RetentionError[]
}

type RetentionClient = ReturnType<typeof createServiceClient>

function normalizeBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE
  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.trunc(value as number)))
}

function retentionCutoff(now: Date): string {
  return new Date(now.getTime() - RETENTION_MS).toISOString()
}

async function loadExpiredRows(
  client: RetentionClient,
  table: RetentionTable,
  cutoff: string,
  batchSize: number,
): Promise<RetentionRow[]> {
  const { data, error } = await client
    .from(table)
    .select('id, storage_path, rejected_at')
    .eq('status', 'rejected')
    .not('storage_path', 'is', null)
    .not('rejected_at', 'is', null)
    .lt('rejected_at', cutoff)
    .order('rejected_at', { ascending: true })
    .limit(batchSize)

  if (error) throw new Error(`Failed to load ${table} retention rows: ${error.message}`)
  return (data ?? []) as RetentionRow[]
}

async function revalidateExpiredRows(
  client: RetentionClient,
  table: RetentionTable,
  rows: RetentionRow[],
  cutoff: string,
): Promise<RetentionRow[]> {
  if (rows.length === 0) return []
  const { data, error } = await client
    .from(table)
    .select('id, storage_path, rejected_at')
    .in('id', rows.map((row) => row.id))
    .eq('status', 'rejected')
    .not('storage_path', 'is', null)
    .not('rejected_at', 'is', null)
    .lt('rejected_at', cutoff)
  if (error) throw new Error(`Failed to revalidate ${table} retention rows: ${error.message}`)
  const current = new Map(
    ((data ?? []) as RetentionRow[]).map((row) => [row.id, row]),
  )
  return rows.filter((row) => {
    const fresh = current.get(row.id)
    return fresh?.storage_path === row.storage_path && fresh.rejected_at === row.rejected_at
  })
}

async function deleteStorageObjects(
  client: RetentionClient,
  rows: RetentionRow[],
): Promise<Set<string>> {
  const paths = [...new Set(rows.map((row) => row.storage_path))].filter(
    (path) => path.startsWith('brands/') || path.startsWith('submissions/'),
  )
  if (paths.length !== new Set(rows.map((row) => row.storage_path)).size) {
    throw new Error('retention row contains an invalid brand-images storage path')
  }
  const deleted = new Set<string>()

  for (let index = 0; index < paths.length; index += STORAGE_DELETE_BATCH_SIZE) {
    const chunk = paths.slice(index, index + STORAGE_DELETE_BATCH_SIZE)
    const { error } = await uploadWithRetry(() =>
      client.storage.from(BRAND_IMAGES_BUCKET).remove(chunk),
    )
    if (error) throw error
    chunk.forEach((path) => deleted.add(path))
  }

  return deleted
}

async function clearRowIfUnchanged(
  client: RetentionClient,
  table: RetentionTable,
  row: RetentionRow,
): Promise<boolean> {
  const { data, error } = await client
    .from(table)
    .update({ storage_path: null })
    .eq('id', row.id)
    .eq('status', 'rejected')
    .eq('rejected_at', row.rejected_at)
    .eq('storage_path', row.storage_path)
    .select('id')

  if (error) throw error
  return Array.isArray(data) && data.length > 0
}

/**
 * Deletes only classifier-rejected objects that have completed the seven-day
 * inspection window. The row guards make a concurrent human/admin decision or
 * a reclassification unable to clear a newer storage reference.
 */
export async function purgeExpiredClassifierJunk(
  options: PurgeClassifierJunkOptions = {},
): Promise<PurgeClassifierJunkSummary> {
  return auditedCall(
    { provider: 'images', operation: 'purgeExpiredClassifierJunk', kind: 'service' },
    async () => {
  const now = options.now ?? new Date()
  const cutoff = retentionCutoff(now)
  const batchSize = normalizeBatchSize(options.batchSize)
  const client = createServiceClient()
  const failed: RetentionError[] = []
  let selected = 0
  let storageDeleted = 0
  let rowsCleared = 0

  for (const table of RETENTION_TABLES) {
    const rows = await revalidateExpiredRows(
      client,
      table,
      await loadExpiredRows(client, table, cutoff, batchSize),
      cutoff,
    )
    selected += rows.length
    if (rows.length === 0) continue

    let deletedPaths: Set<string>
    try {
      deletedPaths = await deleteStorageObjects(client, rows)
      storageDeleted += deletedPaths.size
    } catch (error) {
      const message = error instanceof Error ? error.message : 'storage deletion failed'
      rows.forEach((row) => failed.push({ table, id: row.id, message }))
      continue
    }

    for (const row of rows) {
      if (!deletedPaths.has(row.storage_path)) continue
      try {
        if (await clearRowIfUnchanged(client, table, row)) rowsCleared += 1
      } catch (error) {
        failed.push({
          table,
          id: row.id,
          message: error instanceof Error ? error.message : 'row update failed',
        })
      }
    }
  }

  return { cutoff, selected, storageDeleted, rowsCleared, failed }
    },
  )
}

export { RETENTION_MS, retentionCutoff }
