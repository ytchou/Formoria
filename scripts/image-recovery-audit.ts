import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServiceClient } from '@/lib/supabase/server'

const PAGE_SIZE = 1_000
const UPDATE_BATCH_SIZE = 100
const BACKUP_DIRECTORY = path.join('scripts', 'backup')
const TABLES = ['brand_images', 'submission_images'] as const
type RecoveryTable = (typeof TABLES)[number]

export type PendingImageRow = {
  id: string
  status: string
  source: string | null
  source_url: string | null
  url: string
  storage_path: string | null
  tags: string[] | null
  rejection_reasons: string[] | null
  rejected_at: string | null
  brand_id?: string | null
  submission_id?: string | null
  [key: string]: unknown
}

export type RecoveryEntry = {
  table: RecoveryTable
  row: PendingImageRow
  action: 'block' | 'already_blocked'
}

export type RecoveryReport = {
  generatedAt: string
  mode: 'dry-run' | 'live'
  noSerperCalls: true
  autoPublished: false
  backupPath: string
  entries: RecoveryEntry[]
}

function isAutomatedPending(row: PendingImageRow): boolean {
  return (
    (row.status === 'active' || row.status === 'candidate') &&
    row.tags === null &&
    row.source !== 'owner' &&
    row.source !== 'admin'
  )
}

export function planPendingRecovery(
  rows: Array<{ table: RecoveryTable; row: PendingImageRow }>,
): RecoveryEntry[] {
  return rows.filter(({ row }) => isAutomatedPending(row)).map(({ table, row }) => ({
    table,
    row,
    action: row.status === 'active' ? 'block' : 'already_blocked',
  }))
}

async function fetchAllRows(
  client: ReturnType<typeof createServiceClient>,
  table: RecoveryTable,
): Promise<PendingImageRow[]> {
  const rows: PendingImageRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .in('status', ['active', 'candidate'])
      .is('tags', null)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to load ${table} pending rows: ${error.message}`)
    const page = (data ?? []) as PendingImageRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

function backupName(now: Date): string {
  return `image-recovery-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

async function writeBackup(
  entries: RecoveryEntry[],
  now: Date,
): Promise<string> {
  await mkdir(BACKUP_DIRECTORY, { recursive: true })
  const backupPath = path.join(BACKUP_DIRECTORY, backupName(now))
  await writeFile(
    backupPath,
    `${JSON.stringify({ generatedAt: now.toISOString(), entries }, null, 2)}\n`,
    'utf8',
  )
  return backupPath
}

async function blockPendingRows(
  client: ReturnType<typeof createServiceClient>,
  entries: RecoveryEntry[],
): Promise<void> {
  for (const table of TABLES) {
    const ids = entries
      .filter((entry) => entry.table === table && entry.action === 'block')
      .map((entry) => entry.row.id)
    for (let index = 0; index < ids.length; index += UPDATE_BATCH_SIZE) {
      const { error } = await client
        .from(table)
        .update({ status: 'candidate' })
        .eq('status', 'active')
        .is('tags', null)
        .in('id', ids.slice(index, index + UPDATE_BATCH_SIZE))
      if (error) throw new Error(`Failed to block ${table} pending rows: ${error.message}`)
    }
  }
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live')
  const invalidArgs = process.argv.slice(2).filter((arg) => arg !== '--live')
  if (invalidArgs.length > 0) {
    throw new Error('Usage: image-recovery:audit [--live]')
  }

  const client = createServiceClient()
  const now = new Date()
  const rows = (await Promise.all(
    TABLES.map(async (table) =>
      (await fetchAllRows(client, table)).map((row) => ({ table, row })),
    ),
  )).flat()
  const entries = planPendingRecovery(rows)
  const backupPath = await writeBackup(entries, now)

  if (live) await blockPendingRows(client, entries)

  const report: RecoveryReport = {
    generatedAt: now.toISOString(),
    mode: live ? 'live' : 'dry-run',
    noSerperCalls: true,
    autoPublished: false,
    backupPath,
    entries,
  }
  console.log(JSON.stringify(report, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
