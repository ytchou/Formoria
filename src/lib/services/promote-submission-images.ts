/**
 * DEV-1551 — move an approved brand's imagery from `submissions/` to `brands/`.
 *
 * `approve_submission` (SQL, hand-patched, no source file in this repo) copies
 * `submission_images` rows into `brand_images` and carries `storage_path`
 * across verbatim. The private source object stays in `brand-submissions` as
 * submission history, so publishing requires a verified copy in
 * `brand-images` plus a `brands/` key on the published row. This module performs
 * that promotion at the approval boundary.
 *
 * Planning and execution live in the dependency-free engine at
 * `@/lib/images/submission-image-promotion`; this file is only the Supabase
 * wiring for it.
 */
import {
  executePromotions,
  planPromotions,
  SUBMISSION_IMAGES_KEY_PREFIX,
  type PromotionPlan,
  type PromotionResult,
  type PromotionRow,
  type PromotionStorage,
} from '@/lib/images/submission-image-promotion'
import { imagePathToUrl } from '@/lib/images/image-url'
import { createServiceClient } from '@/lib/supabase/service'
import {
  copySubmissionImageToPublic,
  statStoredImageObject,
} from './image-upload'

type ServiceClient = ReturnType<typeof createServiceClient>

const PAGE_SIZE = 1_000

type BrandImageKeyRow = {
  id: string
  brand_id: string | null
  storage_path: string | null
  status: string
}

/**
 * Supabase-backed implementation of the engine's IO seam. The row update is
 * guarded on the old key so a concurrent writer wins instead of being
 * clobbered, and so a re-run cannot rewrite a row twice.
 */
export function createPromotionStorage(
  supabase: ServiceClient = createServiceClient()
): PromotionStorage {
  return {
    statObject: (key) => statStoredImageObject(key),
    copyObject: (sourceKey, targetKey) =>
      copySubmissionImageToPublic(sourceKey, targetKey),
    setStoragePath: async (rowId, targetKey) => {
      const url = imagePathToUrl(targetKey)
      if (!url) throw new Error(`Invalid public image destination: ${targetKey}`)
      const { error } = await supabase
        .from('brand_images')
        .update({ storage_path: targetKey, url })
        .eq('id', rowId)
        .like('storage_path', `${SUBMISSION_IMAGES_KEY_PREFIX}%`)

      if (error) {
        throw new Error(`Failed to update brand_images:${rowId}: ${error.message}`)
      }
    },
  }
}

/** Every `brand_images` row for one brand that still carries a submissions key. */
async function fetchSubmissionKeyedBrandImages(
  brandId: string,
  supabase: ServiceClient = createServiceClient()
): Promise<PromotionRow[]> {
  const { data, error } = await supabase
    .from('brand_images')
    .select('id, brand_id, storage_path, status')
    .eq('brand_id', brandId)
    .like('storage_path', `${SUBMISSION_IMAGES_KEY_PREFIX}%`)
    .neq('status', 'rejected')
    .order('id', { ascending: true })
    .range(0, PAGE_SIZE - 1)

  if (error) {
    throw new Error(
      `Failed to read brand_images for brand ${brandId}: ${error.message}`
    )
  }

  return ((data ?? []) as BrandImageKeyRow[]).map((record) => ({
    id: String(record.id),
    brandId: record.brand_id,
    storagePath: record.storage_path,
  }))
}

/**
 * Promote one approved brand's imagery. NEVER throws.
 *
 * Approval must not fail because promotion failed: a brand that exists with
 * unservable images is recoverable (a re-run of
 * `scripts/promote-submission-images.ts` fixes it), while a failed approval is
 * not. Every unpromoted key is named in the log so an operator can find it.
 *
 * Returns null when the promotion could not even be attempted.
 */
export async function promoteApprovedBrandImages(
  brandId: string,
  options?: {
    supabase?: ServiceClient
    storage?: PromotionStorage
    /** Injected by tests so this path runs with no Supabase client at all. */
    fetchRows?: (brandId: string) => Promise<PromotionRow[]>
  }
): Promise<PromotionResult | null> {
  try {
    // Built lazily: a caller that injects both seams must not construct a
    // client, and a brand with no submissions-keyed rows must not either.
    const readRows =
      options?.fetchRows ??
      ((id: string) =>
        fetchSubmissionKeyedBrandImages(id, options?.supabase ?? createServiceClient()))

    const rows = await readRows(brandId)
    if (rows.length === 0) {
      return null
    }

    const storage =
      options?.storage ??
      createPromotionStorage(options?.supabase ?? createServiceClient())
    const result = await executePromotions(planPromotions(rows), storage)

    const unpromoted = [
      ...result.conflicts,
      ...result.failures,
      ...result.plan.unresolvable.map((problem) => ({
        sourceKey: problem.storagePath ?? '(null)',
        kind: problem.reason,
        detail: undefined as string | undefined,
      })),
    ]

    if (unpromoted.length > 0) {
      console.error(
        `[promoteApprovedBrandImages] brand ${brandId}: ${unpromoted.length} image(s) still under ${SUBMISSION_IMAGES_KEY_PREFIX} and unservable:`,
        unpromoted
          .map(
            (entry) =>
              `${entry.sourceKey} (${entry.kind}${entry.detail ? `: ${entry.detail}` : ''})`
          )
          .join(', ')
      )
    }

    if (result.copied + result.adopted > 0) {
      console.log(
        `[promoteApprovedBrandImages] brand ${brandId}: promoted ${result.copied + result.adopted} image(s) to brands/`
      )
    }

    return result
  } catch (error) {
    console.error(
      `[promoteApprovedBrandImages] brand ${brandId}: promotion failed entirely; images remain under ${SUBMISSION_IMAGES_KEY_PREFIX}`,
      error instanceof Error ? error.message : error
    )
    return null
  }
}

/**
 * EVERY `brand_images` row still carrying a submissions key, across all pages.
 *
 * PostgREST caps a single response well below the table size, so the range walk
 * is the contract, not an optimization: a sweep that read only the first page
 * would silently leave residue behind and still report success.
 */
async function fetchSubmissionKeyedRows(
  supabase: ServiceClient
): Promise<PromotionRow[]> {
  const rows: PromotionRow[] = []
  let from = 0

  for (;;) {
    const { data, error } = await supabase
      .from('brand_images')
      .select('id, brand_id, storage_path, status')
      .like('storage_path', `${SUBMISSION_IMAGES_KEY_PREFIX}%`)
      .neq('status', 'rejected')
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

export type SweepSummary = {
  scanned: number
  promoted: number
  copied: number
  adopted: number
  skipped: number
  unresolvable: number
  conflicts: number
  failed: number
}

/**
 * The counts the sweep reports, and the only place they are derived. Pure, so
 * the reporting contract is testable without a Supabase client — the repo
 * forbids mocking one, and the sweep's own behavior is covered in
 * `src/lib/services/__tests__/promote-submission-images.test.ts`.
 *
 * Lives here rather than in `/api/cron/promote-submission-images/route.ts`
 * because deriving the counts is business logic, and the File Ownership table
 * in CLAUDE.md leaves API routes only auth, the service call and the response.
 *
 * `failed` counts rows still stuck under `submissions/` after the run:
 * execution failures, target conflicts, and rows the planner could not resolve.
 * All three are the same operational fact — an image that is still unservable.
 */
export function buildSweepSummary(result: PromotionResult): SweepSummary {
  return {
    scanned: result.plan.scanned,
    promoted: result.copied + result.adopted,
    copied: result.copied,
    adopted: result.adopted,
    skipped: result.plan.skipped.length,
    unresolvable: result.plan.unresolvable.length,
    conflicts: result.conflicts.length,
    failed:
      result.failures.length +
      result.conflicts.length +
      result.plan.unresolvable.length,
  }
}

/** A dry run reports the plan without touching storage or any row. */
function dryRunResult(plan: PromotionPlan): PromotionResult {
  return { plan, outcomes: [], copied: 0, adopted: 0, conflicts: [], failures: [] }
}

/**
 * DEV-1744 — the batch sweep: promote every `brand_images` row still under
 * `submissions/`, brand-agnostic. NEVER throws, for the same reason
 * `promoteApprovedBrandImages` does not: a per-row copy failure leaves that row
 * recoverable on the next run, and must not abort the rest of the sweep.
 *
 * This is the safety net under the per-approval hook. If that hook fails for a
 * newly-approved brand, the scheduled sweep
 * (`/api/cron/promote-submission-images`) still makes its images servable
 * within one cron interval. The operator CLI
 * (`scripts/enrichment/images/promote-submission-images.ts`) is the same code
 * path with `dryRun` on by default.
 *
 * Returns null only when the sweep could not be attempted at all (the row read
 * itself failed) — the caller reports that as a failed run.
 */
export async function sweepPendingPromotions(options?: {
  supabase?: ServiceClient
  storage?: PromotionStorage
  /** Injected by tests so this path runs with no Supabase client at all. */
  fetchRows?: () => Promise<PromotionRow[]>
  /** Plan only; writes nothing. */
  dryRun?: boolean
}): Promise<PromotionResult | null> {
  try {
    // Built lazily, like the per-brand path: a caller that injects both seams
    // must never construct a client.
    const readRows =
      options?.fetchRows ??
      (() => fetchSubmissionKeyedRows(options?.supabase ?? createServiceClient()))

    const plan = planPromotions(await readRows())

    if (options?.dryRun) {
      return dryRunResult(plan)
    }

    const storage =
      options?.storage ??
      createPromotionStorage(options?.supabase ?? createServiceClient())

    return await executePromotions(plan, storage)
  } catch (error) {
    console.error(
      `[sweepPendingPromotions] sweep failed entirely; rows remain under ${SUBMISSION_IMAGES_KEY_PREFIX}`,
      error instanceof Error ? error.message : error
    )
    return null
  }
}
