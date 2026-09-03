/**
 * DEV-1551 — promote an approved brand's imagery out of `submissions/`.
 *
 * `approve_submission` copies `submission_images` rows into `brand_images` and
 * carries `storage_path` across verbatim, so an approved brand keeps
 * `submissions/<submission-id>/<file>` keys forever. Once the `brand-images`
 * bucket is private that key is refused by the read proxy
 * (`PRIVATE_IMAGE_PREFIXES` in `image-proxy.ts`), because privacy there is
 * decided by prefix alone — the proxy cannot read row status without a
 * per-request database round trip, which was rejected on performance grounds.
 *
 * The invariant the proxy encodes is therefore only true if the OBJECT moves
 * when it becomes public. This module is the move.
 *
 * Deliberately dependency-free, like `storage-keys.ts`: the planning rules and
 * the execution engine must be unit-testable with plain row objects and a fake
 * storage, because this repo forbids mocking Supabase and partial-mocking the
 * heavy `image-upload` graph is a known test-runtime hazard. All Supabase calls
 * live behind the `PromotionStorage` seam, implemented in
 * `@/lib/services/promote-submission-images`.
 */
import { BRAND_IMAGES_KEY_PREFIX } from './storage-keys'

/** Pre-moderation submission imagery. Refused by the public read proxy. */
export const SUBMISSION_IMAGES_KEY_PREFIX = 'submissions/'

/** A `brand_images` row reduced to the fields the decision depends on. */
export type PromotionRow = {
  id: string
  brandId: string | null | undefined
  storagePath: string | null | undefined
}

type PromotionEntry = {
  id: string
  brandId: string
  sourceKey: string
  targetKey: string
}

type PromotionSkipReason =
  /** Already carries a `brands/` key — the post-promotion steady state. */
  | 'already-promoted'
  /** No key to move; nothing this job can do. */
  | 'no-storage-path'
  /** Some other prefix (`curated-products/`, `event-exhibitors/`) — not ours. */
  | 'other-prefix'

type PromotionProblemReason = 'missing-brand-id' | 'malformed-key'

type PromotionSkip = {
  id: string
  storagePath: string | null
  reason: PromotionSkipReason
}

type PromotionProblem = {
  id: string
  storagePath: string | null
  reason: PromotionProblemReason
}

export type PromotionPlan = {
  scanned: number
  promote: PromotionEntry[]
  skipped: PromotionSkip[]
  /** Reported, never guessed at. */
  unresolvable: PromotionProblem[]
}

function trimmed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const candidate = value.trim()
  return candidate.length > 0 ? candidate : null
}

/**
 * The public key an approved brand's image should live under, or null when the
 * input is not a promotable submission key. Null is a REPORT, never a guess:
 * the caller records the row as unresolvable and writes nothing.
 *
 * Shape required: `submissions/<submission-id>/<filename>`. A key with fewer
 * segments, an empty segment, or any `..` is malformed — a brand's public key
 * is not something to reconstruct from a broken input.
 */
export function resolvePromotedKey(
  brandId: string | null | undefined,
  storagePath: string | null | undefined,
): string | null {
  const brand = trimmed(brandId)
  const key = trimmed(storagePath)
  if (!brand || !key || brand.includes('/')) {
    return null
  }
  if (!key.startsWith(SUBMISSION_IMAGES_KEY_PREFIX)) {
    return null
  }

  const segments = key.slice(SUBMISSION_IMAGES_KEY_PREFIX.length).split('/')
  if (segments.length < 2) {
    return null
  }
  if (segments.some((segment) => segment.length === 0 || segment === '..')) {
    return null
  }

  const filename = segments[segments.length - 1]
  if (filename === undefined) {
    return null
  }

  return `${BRAND_IMAGES_KEY_PREFIX}${brand}/${filename}`
}

/**
 * Decide what would be written. Pure: no client, no IO. Idempotent by
 * construction — a row already under `brands/` is counted as skipped and can
 * never appear in `promote`, so a second run over promoted rows plans nothing.
 */
export function planPromotions(rows: readonly PromotionRow[]): PromotionPlan {
  const plan: PromotionPlan = {
    scanned: rows.length,
    promote: [],
    skipped: [],
    unresolvable: [],
  }

  for (const row of rows) {
    const key = trimmed(row.storagePath)
    if (!key) {
      plan.skipped.push({ id: row.id, storagePath: null, reason: 'no-storage-path' })
      continue
    }
    if (key.startsWith(BRAND_IMAGES_KEY_PREFIX)) {
      plan.skipped.push({ id: row.id, storagePath: key, reason: 'already-promoted' })
      continue
    }
    if (!key.startsWith(SUBMISSION_IMAGES_KEY_PREFIX)) {
      plan.skipped.push({ id: row.id, storagePath: key, reason: 'other-prefix' })
      continue
    }

    const brandId = trimmed(row.brandId)
    if (!brandId) {
      plan.unresolvable.push({
        id: row.id,
        storagePath: key,
        reason: 'missing-brand-id',
      })
      continue
    }

    const targetKey = resolvePromotedKey(brandId, key)
    if (targetKey === null) {
      plan.unresolvable.push({ id: row.id, storagePath: key, reason: 'malformed-key' })
      continue
    }

    plan.promote.push({ id: row.id, brandId, sourceKey: key, targetKey })
  }

  return plan
}

export type StoredObjectStat = { size: number }

/**
 * The whole IO surface of a promotion. Implemented over Supabase in the service
 * layer and over a plain Map in the tests.
 */
export type PromotionStorage = {
  /** Null when the object does not exist. */
  statObject(key: string): Promise<StoredObjectStat | null>
  /** Server-side copy. Must never overwrite an existing target. */
  copyObject(sourceKey: string, targetKey: string): Promise<void>
  /** Rewrite `brand_images.storage_path` for one row. */
  setStoragePath(rowId: string, targetKey: string): Promise<void>
}

type PromotionOutcomeKind =
  /** Object copied and the row rewritten. */
  | 'copied'
  /** An identical object was already at the target; only the row was rewritten. */
  | 'adopted'
  /** A DIFFERENT object occupies the target. Nothing written. */
  | 'conflict'
  /** Storage or the row update errored. Row still points at the old key. */
  | 'failed'

type PromotionOutcome = {
  id: string
  sourceKey: string
  targetKey: string
  kind: PromotionOutcomeKind
  detail?: string
}

export type PromotionResult = {
  plan: PromotionPlan
  outcomes: PromotionOutcome[]
  copied: number
  adopted: number
  conflicts: PromotionOutcome[]
  failures: PromotionOutcome[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Execute a plan. NEVER throws and NEVER deletes: a per-row failure is recorded
 * and the remaining rows still run. A failed row keeps its `submissions/` key,
 * which is the recoverable state — the row can be promoted by a later re-run.
 *
 * The source object is deliberately left in place. A promotion that deleted the
 * source before the row update landed would be unrecoverable;
 * `scripts/brand-storage-maintenance.ts` can sweep the leftovers once promotion
 * is proven in production. Ceiling: the bucket carries one duplicate object per
 * promoted image until that sweep runs.
 */
export async function executePromotions(
  plan: PromotionPlan,
  storage: PromotionStorage,
): Promise<PromotionResult> {
  const outcomes: PromotionOutcome[] = []

  for (const entry of plan.promote) {
    const base = {
      id: entry.id,
      sourceKey: entry.sourceKey,
      targetKey: entry.targetKey,
    }

    try {
      const existing = await storage.statObject(entry.targetKey)

      if (existing !== null) {
        // A target already holding OUR object is the signature of a run that
        // copied and then died before the row update. Size is the only cheap
        // identity signal Storage offers; a mismatch is treated as a foreign
        // object and left strictly alone. Upgrade path: compare checksums once
        // the bucket exposes them.
        const source = await storage.statObject(entry.sourceKey)
        if (source !== null && source.size !== existing.size) {
          outcomes.push({
            ...base,
            kind: 'conflict',
            detail: `target occupied by a different object (${existing.size} bytes vs source ${source.size})`,
          })
          continue
        }

        await storage.setStoragePath(entry.id, entry.targetKey)
        outcomes.push({ ...base, kind: 'adopted' })
        continue
      }

      await storage.copyObject(entry.sourceKey, entry.targetKey)
      await storage.setStoragePath(entry.id, entry.targetKey)
      outcomes.push({ ...base, kind: 'copied' })
    } catch (error) {
      outcomes.push({ ...base, kind: 'failed', detail: errorMessage(error) })
    }
  }

  return {
    plan,
    outcomes,
    copied: outcomes.filter((outcome) => outcome.kind === 'copied').length,
    adopted: outcomes.filter((outcome) => outcome.kind === 'adopted').length,
    conflicts: outcomes.filter((outcome) => outcome.kind === 'conflict'),
    failures: outcomes.filter((outcome) => outcome.kind === 'failed'),
  }
}

const SAMPLE_SIZE = 20

function countBy<T extends string>(values: readonly { reason: T }[]): string {
  const counts = new Map<T, number>()
  for (const value of values) {
    counts.set(value.reason, (counts.get(value.reason) ?? 0) + 1)
  }
  return [...counts.entries()].map(([reason, count]) => `${reason} ${count}`).join(', ')
}

export function formatPromotionReport(
  result: PromotionResult,
  options: { live: boolean; heading?: string },
): string {
  const { plan } = result
  const lines: string[] = []
  const heading = options.heading ?? 'Submission image promotion'

  lines.push(options.live ? `${heading} (LIVE)` : `${heading} (dry run)`)
  lines.push('')
  lines.push(`- brand_images scanned: ${plan.scanned}`)
  lines.push(
    `- ${options.live ? 'promoted' : 'would promote'} ${plan.promote.length}` +
      ` (copied ${result.copied}, adopted ${result.adopted})`,
  )
  lines.push(
    `- skipped: ${plan.skipped.length}${plan.skipped.length > 0 ? ` (${countBy(plan.skipped)})` : ''}`,
  )
  lines.push(
    `- unresolvable: ${plan.unresolvable.length}` +
      `${plan.unresolvable.length > 0 ? ` (${countBy(plan.unresolvable)})` : ''}`,
  )
  lines.push(`- conflicts: ${result.conflicts.length}`)
  lines.push(`- failures: ${result.failures.length}`)

  if (plan.unresolvable.length > 0) {
    lines.push('')
    lines.push('Unresolvable rows (reported, nothing written):')
    for (const problem of plan.unresolvable.slice(0, SAMPLE_SIZE)) {
      lines.push(`  ${problem.id} ${problem.reason} ${problem.storagePath ?? '(null)'}`)
    }
    if (plan.unresolvable.length > SAMPLE_SIZE) {
      lines.push(`  ... and ${plan.unresolvable.length - SAMPLE_SIZE} more`)
    }
  }

  const problems = [...result.conflicts, ...result.failures]
  if (problems.length > 0) {
    lines.push('')
    lines.push('Rows still pointing at a submissions/ key:')
    for (const outcome of problems.slice(0, SAMPLE_SIZE)) {
      lines.push(
        `  ${outcome.id} ${outcome.kind} ${outcome.sourceKey} -> ${outcome.targetKey}` +
          `${outcome.detail ? ` (${outcome.detail})` : ''}`,
      )
    }
    if (problems.length > SAMPLE_SIZE) {
      lines.push(`  ... and ${problems.length - SAMPLE_SIZE} more`)
    }
  }

  if (!options.live) {
    lines.push('')
    lines.push('Dry run complete. Re-run with `promote --live` to copy and rewrite.')
  }

  return lines.join('\n')
}
