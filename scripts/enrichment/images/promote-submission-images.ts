/**
 * @formoria-script
 * purpose: Promotes brand_images rows out of the submissions/ storage prefix into brands/.
 * class: operator
 * invoke: pnpm exec tsx scripts/enrichment/images/promote-submission-images.ts
 * target: staging-default
 * safety: dry-run-default
 * owner: engineering
 * notes: pending one-off: 13 rows on 2026-09-02
 */
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
 * Audit-by-default, like `scripts/enrichment/images/backfill-storage-paths.ts`:
 *
 *   pnpm tsx scripts/enrichment/images/promote-submission-images.ts             # audit, no writes
 *   pnpm tsx scripts/enrichment/images/promote-submission-images.ts audit
 *   pnpm tsx scripts/enrichment/images/promote-submission-images.ts promote --live
 *
 * `promote` without `--live` is still a dry run.
 *
 * The source object is NEVER deleted. A promotion that removed the source
 * before the row update landed would be unrecoverable;
 * `scripts/enrichment/images/brand-storage-maintenance.ts` can sweep the duplicates later, once
 * promotion is proven. Ceiling: the bucket carries one extra object per
 * promoted image until that sweep runs.
 *
 * Structure note: all derivation and decision logic lives in the exported pure
 * seam of `@/lib/images/submission-image-promotion` (`resolvePromotedKey`,
 * `planPromotions`, `executePromotions`, `formatPromotionReport`) and is unit
 * tested with plain row objects and a fake storage. This repo forbids mocking
 * Supabase, so the seam must be drivable without a client.
 *
 * DEV-1744: the batch orchestration (paginated read, plan, execute) moved to
 * `sweepPendingPromotions` in `@/lib/services/promote-submission-images`, which
 * the daily cron route `/api/cron/promote-submission-images` also calls. This
 * file is now only argument parsing and report formatting — there must be no
 * second copy of the query here for the two callers to drift apart on.
 */
import { formatPromotionReport } from '@/lib/images/submission-image-promotion'
import { sweepPendingPromotions } from '@/lib/services/promote-submission-images'
import { loadScriptTarget } from '../../shared/target'

async function run(live: boolean): Promise<void> {
  // The sweep itself (fetch + plan + execute) lives in the service layer
  // (DEV-1744) so the daily cron route and this CLI cannot drift apart. This
  // file only parses arguments and formats the report.
  const result = await sweepPendingPromotions({ dryRun: !live })

  if (result === null) {
    console.error('Promotion sweep failed before it could run; nothing written.')
    process.exitCode = 1
    return
  }

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
