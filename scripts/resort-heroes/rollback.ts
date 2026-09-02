import { readFile } from 'node:fs/promises'
import { syncHeroDenormalized } from '@/lib/services/brand-images'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'
import { createServiceClient } from '@/lib/supabase/service'
import { loadActiveRows, type RestoreManifest } from './shared'
import { loadScriptTarget } from '../shared/target'

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

// Brands are independent, so restores run in parallel. Sequential per-brand round
// trips made rollback latency scale linearly with brand count at exactly the
// moment an operator is racing to restore ~844 brands. The read still happens
// immediately before that brand's own writes, so widening the check-to-write
// window is not part of the trade.
const CONCURRENCY = 4

function manifestArg(): string {
  const index = process.argv.indexOf('--manifest')
  const path = process.argv.at(index + 1)
  if (index === -1 || !path)
    throw new Error('usage: resort-heroes:rollback --manifest <path>')
  return path
}

async function main(): Promise<void> {
  loadScriptTarget()
  const manifest = JSON.parse(
    await readFile(manifestArg(), 'utf8'),
  ) as RestoreManifest
  const supabase = createServiceClient()
  const refused: string[] = []
  const failed: string[] = []

  await mapWithConcurrency(manifest.brands, CONCURRENCY, async (entry) => {
    const rows = await loadActiveRows(supabase, entry.brandId)
    if (membership(rows) !== membership(entry.images)) {
      refused.push(entry.brandId)
      return
    }
    // A failure on one brand is recorded and reported rather than thrown: this is
    // the recovery path, and aborting it would strand every brand not yet
    // restored. Re-running the same manifest is safe — membership is unchanged by
    // a sort_order restore, so an already-restored brand simply rewrites the same
    // values.
    try {
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
    } catch (error: unknown) {
      failed.push(
        `${entry.brandId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  const restored = manifest.brands.length - refused.length - failed.length
  console.log(`rollback restored ${restored} brand(s)`)
  if (refused.length > 0) {
    console.error(
      `rollback refused ${refused.length} moved brand(s): ${refused.join(', ')}`,
    )
  }
  if (failed.length > 0) {
    console.error(
      `rollback failed for ${failed.length} brand(s):\n  ${failed.join('\n  ')}\nRe-run with the same manifest once the cause is fixed.`,
    )
  }
  if (refused.length > 0 || failed.length > 0) process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(
    '\nFAILED:',
    error instanceof Error ? error.message : JSON.stringify(error),
  )
  process.exitCode = 1
})

export {}
