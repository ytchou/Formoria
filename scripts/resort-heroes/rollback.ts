import { readFile } from 'node:fs/promises'
import { syncHeroDenormalized } from '@/lib/services/brand-images'
import { createServiceClient } from '@/lib/supabase/service'
import { selectAllPages, type ActiveRow, type RestoreManifest } from './shared'

/**
 * Rollback deliberately does NOT compare sort_order against the manifest: after a
 * successful apply the live sort orders are the NEW ones, so a sort_order-based
 * fingerprint would refuse every brand it is supposed to restore. What must not
 * have moved is the *membership* of the active set — a row rejected, added, or
 * re-activated since the manifest was written means the recorded ordering no
 * longer describes this brand and replaying it would place a stale plan.
 */
function membership(rows: Array<{ id: string }>): string {
  return rows
    .map((row) => row.id)
    .toSorted((a, b) => a.localeCompare(b))
    .join(',')
}

function manifestArg(): string {
  const index = process.argv.indexOf('--manifest')
  const path = process.argv.at(index + 1)
  if (index === -1 || !path)
    throw new Error('usage: resort-heroes:rollback --manifest <path>')
  return path
}

async function activeRows(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string,
): Promise<ActiveRow[]> {
  return selectAllPages<ActiveRow>((from, to) =>
    supabase
      .from('brand_images')
      .select('*')
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, to),
  )
}

async function main(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(manifestArg(), 'utf8'),
  ) as RestoreManifest
  const supabase = createServiceClient()
  const refused: string[] = []
  for (const entry of manifest.brands) {
    const rows = await activeRows(supabase, entry.brandId)
    if (membership(rows) !== membership(entry.images)) {
      refused.push(entry.brandId)
      continue
    }
    for (const image of entry.images.toSorted(
      (a, b) => (b.sort_order ?? -1) - (a.sort_order ?? -1),
    )) {
      const { error } = await supabase
        .from('brand_images')
        .update({ sort_order: image.sort_order })
        .eq('id', image.id)
      if (error)
        throw new Error(
          `failed to restore ${entry.brandId}/${image.id}: ${error.message}`,
        )
    }
    await syncHeroDenormalized(supabase, entry.brandId)
  }
  if (refused.length > 0) {
    console.error(
      `rollback refused ${refused.length} moved brand(s): ${refused.join(', ')}`,
    )
    process.exitCode = 1
    return
  }
  console.log(`rollback complete: ${manifest.brands.length} brand(s)`)
}

void main().catch((error: unknown) => {
  console.error(
    '\nFAILED:',
    error instanceof Error ? error.message : JSON.stringify(error),
  )
  process.exitCode = 1
})

export {}
