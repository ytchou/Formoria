export type BrandWriteActor = {
  source: 'enriched' | 'owner' | 'admin'
  userId?: string
  jobId?: string
}

export type BrandFieldWriteState = {
  source: string
  adminLocked?: boolean
  updatedAt?: string
}

export type SkippedBrandField = {
  field: string
  reason: string
}

export type WritablePatchResult = {
  allowed: Record<string, unknown>
  skipped: SkippedBrandField[]
}

const ENRICHMENT_EXCLUDED_FIELDS = new Set(['mitStory', 'mit_story'])
const OWNER_PROTECTED_FIELDS = new Set([
  'mit_status',
  'mit_declared_scope',
  'mit_declared_at',
  'mit_declared_by',
])
const REFRESH_ENRICHMENT_EXCLUDED_FIELDS = new Set([
  'id',
  'name',
  'slug',
  'romanized_name',
  'status',
  'source',
  'contact_email',
  'mit_story',
  'mit_status',
  'mit_verified_at',
  'approved_at',
  'submitted_at',
  'created_at',
  'updated_at',
  'is_demo',
])

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Sentinel key on an enrichment patch: fields the enrichment ran on and
 * affirmatively determined should be EMPTY. It is not a brand column, so it is
 * routed around the per-field loop and filtered on its entries instead.
 */
export const CLEARED_FIELDS_KEY = '_cleared_fields'

/** `null` when a refresh may write this field, otherwise the skip reason. */
function refreshWriteBlockReason(
  field: string,
  baseValues: Record<string, unknown>,
  fieldState: Record<string, BrandFieldWriteState>
): string | null {
  const state = fieldState[field]
  if (REFRESH_ENRICHMENT_EXCLUDED_FIELDS.has(field)) return 'excluded:identity'
  if (state?.adminLocked) return 'protected:admin_locked'
  if (state && ['owner', 'admin', 'submitted'].includes(state.source)) return `protected:${state.source}`
  if (state?.source === 'enriched' || isEmptyValue(baseValues[field])) return null
  return `protected:${state?.source ?? 'unclassified'}`
}

export function resolveRefreshEnrichmentPatch(
  patch: Record<string, unknown>,
  baseValues: Record<string, unknown>,
  fieldState: Record<string, BrandFieldWriteState>
): WritablePatchResult {
  const allowed: Record<string, unknown> = {}
  const skipped: SkippedBrandField[] = []

  for (const [field, value] of Object.entries(patch)) {
    if (field === CLEARED_FIELDS_KEY) continue
    const reason = refreshWriteBlockReason(field, baseValues, fieldState)
    if (reason) {
      skipped.push({ field, reason })
      continue
    }
    allowed[field] = value
  }

  // Clearing a field is a write. A locked field must be dropped from the
  // cleared list rather than silently emptied, and it goes through the same
  // `skipped` channel so the `[refresh-enrichment:protected-fields]` log covers
  // it. The `cleared:` prefix keeps a dropped clear distinguishable from a
  // dropped value in that log.
  const clearedFields = patch[CLEARED_FIELDS_KEY]
  if (Array.isArray(clearedFields)) {
    const allowedCleared: string[] = []
    for (const field of clearedFields) {
      if (typeof field !== 'string') continue
      const reason = refreshWriteBlockReason(field, baseValues, fieldState)
      if (reason) {
        skipped.push({ field, reason: `cleared:${reason}` })
        continue
      }
      allowedCleared.push(field)
    }
    if (allowedCleared.length > 0) {
      allowed[CLEARED_FIELDS_KEY] = allowedCleared
    }
  }

  return { allowed, skipped }
}

export function resolveWritablePatch(
  patch: Record<string, unknown>,
  fieldState: Record<string, BrandFieldWriteState>,
  actor: BrandWriteActor,
): WritablePatchResult {
  const allowed: Record<string, unknown> = {}
  const skipped: SkippedBrandField[] = []

  for (const [field, value] of Object.entries(patch)) {
    const state = fieldState[field]

    if (actor.source === 'admin') {
      allowed[field] = value
      continue
    }

    if (actor.source === 'owner') {
      if (OWNER_PROTECTED_FIELDS.has(field)) {
        skipped.push({ field, reason: 'protected:service_managed' })
        continue
      }

      if (state?.adminLocked === true) {
        skipped.push({ field, reason: 'protected:admin_locked' })
        continue
      }

      allowed[field] = value
      continue
    }

    if (ENRICHMENT_EXCLUDED_FIELDS.has(field)) {
      skipped.push({ field, reason: 'excluded:mit_story' })
      continue
    }

    if (state && state.source !== 'enriched') {
      skipped.push({ field, reason: `protected:${state.source}` })
      continue
    }

    allowed[field] = value
  }

  return { allowed, skipped }
}
