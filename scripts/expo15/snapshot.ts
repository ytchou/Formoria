/**
 * Full read-only snapshot of the 15 expo brands as they exist in production.
 *
 * Run once BEFORE the refresh and once AFTER. The "before" file is not only the
 * left-hand column of the comparison — it is the rollback copy. `select('*')`
 * is deliberate: a column added later must land in the backup without anyone
 * remembering to update a field list, because the whole point of this file is
 * to be able to put production back.
 *
 * Related rows are captured too (images, FAQs, channels, stockists), since the
 * refresh rewrites those as well and restoring only `brands` would leave the
 * brand pointing at images that no longer exist.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/expo15/snapshot.ts --out before.json
 */
import { writeFile, mkdir, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { EXPO15_SLUGS } from './brands'

const OUT_ROOT = 'scripts/expo15/snapshots'

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv.at(index + 1)
}

async function refuseToClobber(path: string): Promise<void> {
  try {
    await access(path)
  } catch {
    return
  }
  throw new Error(`refusing to overwrite ${path} — this may be the only backup. Pass a different --out`)
}

/** Child tables keyed by brand_id that the refresh rewrites. */
const CHILD_TABLES = ['brand_images', 'brand_faq', 'brand_channels'] as const

async function main(): Promise<void> {
  const out = resolve(OUT_ROOT, argValue('--out') ?? `snapshot-${Date.now()}.json`)
  await refuseToClobber(out)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: brands, error } = await supabase
    .from('brands')
    .select('*')
    .in('slug', [...EXPO15_SLUGS])
  if (error) throw error

  const rows = brands ?? []
  if (rows.length !== EXPO15_SLUGS.length) {
    const found = new Set(rows.map((b) => (b as { slug: string }).slug))
    const missing = EXPO15_SLUGS.filter((s) => !found.has(s))
    // Hard failure: a partial "before" silently becomes a partial rollback.
    throw new Error(`only ${rows.length}/${EXPO15_SLUGS.length} brands found. Missing: ${missing.join(', ')}`)
  }

  const ids = rows.map((b) => (b as { id: string }).id)
  const children: Record<string, unknown[]> = {}
  for (const table of CHILD_TABLES) {
    const { data, error: childError } = await supabase.from(table).select('*').in('brand_id', ids)
    if (childError) {
      // A missing table is fatal for a backup — better to know now than at restore.
      throw new Error(`${table}: ${JSON.stringify(childError)}`)
    }
    children[table] = data ?? []
    console.log(`  ${table.padEnd(16)} ${(data ?? []).length} row(s)`)
  }

  await mkdir(dirname(out), { recursive: true })
  await writeFile(
    out,
    JSON.stringify(
      { capturedAt: new Date().toISOString(), slugs: [...EXPO15_SLUGS], brands: rows, children },
      null,
      2
    )
  )
  console.log(`\nwrote ${out}`)
  console.log(`  ${rows.length} brands, ${Object.values(children).reduce((n, r) => n + r.length, 0)} child rows`)
}

void main().catch((e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : JSON.stringify(e))
  process.exitCode = 1
})

export {}
