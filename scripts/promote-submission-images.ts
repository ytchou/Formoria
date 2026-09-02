/**
 * DEV-1551 — promote existing `brand_images` rows out of `submissions/`.
 *
 * `approve_submission` carries `submission_images.storage_path` into
 * `brand_images` verbatim and never moves the storage object, so 781 of the
 * 1,425 `brand_images` rows on staging (a restore of production, measured
 * 2026-08-23) still carry a `submissions/<submission-id>/<file>` key. The
 * same-origin read proxy refuses that prefix — `submissions/` is
 * pre-moderation content — so 55% of brand imagery is unservable once the
 * `brand-images` bucket is private. `promoteApprovedBrandImages` fixes every
 * FUTURE approval; this script fixes the rows that already exist.
 *
 * Audit-by-default, like `scripts/backfill-storage-paths.ts`:
 *
 *   pnpm tsx scripts/promote-submission-images.ts             # audit, no writes
 *   pnpm tsx scripts/promote-submission-images.ts audit
 *   pnpm tsx scripts/promote-submission-images.ts promote --live
 *
 * `promote` without `--live` is still a dry run.
 *
 * The source object is NEVER deleted. A promotion that removed the source
 * before the row update landed would be unrecoverable;
 * `scripts/brand-storage-maintenance.ts` can sweep the duplicates later, once
 * promotion is proven. Ceiling: the bucket carries one extra object per
 * promoted image until that sweep runs.
 *
 * Structure note: all derivation and decision logic lives in the exported pure
 * seam of `@/lib/images/submission-image-promotion` (`resolvePromotedKey`,
 * `planPromotions`, `executePromotions`, `formatPromotionReport`) and is unit
 * tested with plain row objects and a fake storage. This repo forbids mocking
 * Supabase, so the seam must be drivable without a client.
 */
import {
  executePromotions,
  formatPromotionReport,
  planPromotions,
  SUBMISSION_IMAGES_KEY_PREFIX,
  type PromotionPlan,
  type PromotionResult,
  type PromotionRow,
} from '@/lib/images/submission-image-promotion'
import { createPromotionStorage } from '@/lib/services/promote-submission-images'
import { createServiceClient } from '@/lib/supabase/service'
import { loadScriptTarget } from './shared/target'

const PAGE_SIZE = 1_000

type ServiceClient = ReturnType<typeof createServiceClient>

type BrandImageKeyRow = {
  id: string
  brand_id: string | null
  storage_path: string | null
}

async function fetchSubmissionKeyedRows(
  supabase: ServiceClient
): Promise<PromotionRow[]> {
  const rows: PromotionRow[] = []
  let from = 0

  for (;;) {
    const { data, error } = await supabase
      .from('brand_images')
      .select('id, brand_id, storage_path')
      .like('storage_path', `${SUBMISSION_IMAGES_KEY_PREFIX}%`)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to read brand_images: ${error.message}`)
    }

    const page = (data ?? []) as BrandImageKeyRow[]
    for (const record of page) {
      rows.push({
        id: String(record.id),
        brandId: record.brand_id,
        storagePath: record.storage_path,
      })
    }

    if (page.length < PAGE_SIZE) {
      break
    }
    from += PAGE_SIZE
  }

  return rows
}

/** A dry run reports the plan without touching storage or any row. */
function dryRunResult(plan: PromotionPlan): PromotionResult {
  return { plan, outcomes: [], copied: 0, adopted: 0, conflicts: [], failures: [] }
}

async function run(live: boolean): Promise<void> {
  const supabase = createServiceClient()
  const rows = await fetchSubmissionKeyedRows(supabase)
  const plan = planPromotions(rows)

  const result = live
    ? await executePromotions(plan, createPromotionStorage(supabase))
    : dryRunResult(plan)

  console.log(
    formatPromotionReport(result, {
      live,
      heading: 'brand_images submissions/ promotion',
    })
  )

  if (live && (result.failures.length > 0 || result.conflicts.length > 0)) {
    // A partial run is safe to repeat: promoted rows now carry a `brands/` key
    // and are skipped, and an identical object already at the target is adopted
    // rather than copied again.
    process.exitCode = 1
  }
}

const USAGE =
  'Usage: promote-submission-images.ts [audit | promote [--live]] (audit is the default and writes nothing)'

async function main(): Promise<void> {
  const { argv } = loadScriptTarget()
  const subcommand = argv[0] ?? 'audit'
  const args = argv.slice(1)

  if (subcommand === 'audit' && args.length === 0) {
    await run(false)
    return
  }

  if (
    subcommand === 'promote' &&
    args.every((argument) => argument === '--live') &&
    args.length <= 1
  ) {
    await run(args.includes('--live'))
    return
  }

  if (subcommand !== 'audit' && subcommand !== 'promote') {
    throw new Error(`Unknown subcommand "${subcommand}". ${USAGE}`)
  }

  throw new Error(`Invalid arguments for ${subcommand}. ${USAGE}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
