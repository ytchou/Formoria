import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

type ReputationSummary = { text: string; sources: { url: string }[] }
type SeedEntry = { slug: string; reputationSummary?: ReputationSummary | null }
type CliArgs = { file: string; dryRun: boolean; overwrite: boolean }

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    )
  }
  return createSupabaseClient(url, serviceRoleKey)
}

function parseArgs(argv: string[]): CliArgs {
  const index = argv.indexOf('--file')
  const equalsFile = argv.find((arg) => arg.startsWith('--file='))?.slice(7)
  const file = equalsFile ?? (index >= 0 ? argv[index + 1] : undefined)
  if (!file) throw new Error('Missing required --file <path>')
  return {
    file,
    dryRun: argv.includes('--dry-run'),
    overwrite: argv.includes('--overwrite'),
  }
}

function isEntry(value: unknown): value is SeedEntry {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (typeof item.slug !== 'string' || !item.slug.trim()) return false
  if (item.reputationSummary == null) return true
  if (typeof item.reputationSummary !== 'object') return false
  const reputation = item.reputationSummary as Record<string, unknown>
  return (
    typeof reputation.text === 'string' &&
    reputation.text.trim().length > 0 &&
    Array.isArray(reputation.sources) &&
    reputation.sources.length > 0 &&
    reputation.sources.every(
      (source) =>
        source &&
        typeof source === 'object' &&
        typeof (source as Record<string, unknown>).url === 'string' &&
        Boolean(((source as Record<string, unknown>).url as string).trim()),
    )
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const parsed = JSON.parse(
    await readFile(path.resolve(args.file), 'utf8'),
  ) as unknown
  if (!Array.isArray(parsed))
    throw new Error('Input file must contain a JSON array')

  const supabase = createServiceClient()
  for (const value of parsed) {
    if (!isEntry(value) || !value.reputationSummary) continue
    const slug = value.slug.trim()
    const { data, error } = await supabase
      .from('brands')
      .select('reputation_summary')
      .eq('slug', slug)
      .maybeSingle()
    if (error) throw error
    if (!data || (!args.overwrite && data.reputation_summary != null)) continue
    if (args.dryRun) {
      console.log(`[dry-run] ${slug}: would update reputation_summary`)
      continue
    }
    const { error: updateError } = await supabase
      .from('brands')
      .update({ reputation_summary: value.reputationSummary })
      .eq('slug', slug)
    if (updateError) throw updateError
    console.log(`[seeded] ${slug}`)
  }
}

if (process.argv[1]?.endsWith('seed-expansion-data.ts')) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
