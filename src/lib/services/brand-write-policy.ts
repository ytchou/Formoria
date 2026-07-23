import { reconcileRetailLocationEnrichment } from '@/lib/brands/locations'

export type BrandWriteActor = {
  source: 'enriched' | 'owner' | 'admin'
  userId?: string
  jobId?: string
}

export type BrandFieldWriteState = {
  source: string
  adminLocked?: boolean
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

export function resolveRefreshEnrichmentPatch(
  patch: Record<string, unknown>,
  baseValues: Record<string, unknown>,
  fieldState: Record<string, BrandFieldWriteState>
): WritablePatchResult {
  const allowed: Record<string, unknown> = {}
  const skipped: SkippedBrandField[] = []

  for (const [field, value] of Object.entries(patch)) {
    const state = fieldState[field]
    if (field === 'retail_locations') {
      allowed[field] = reconcileRetailLocationEnrichment(baseValues[field], value)
      continue
    }
    if (REFRESH_ENRICHMENT_EXCLUDED_FIELDS.has(field)) {
      skipped.push({ field, reason: 'excluded:identity' })
      continue
    }
    if (state?.adminLocked) {
      skipped.push({ field, reason: 'protected:admin_locked' })
      continue
    }
    if (state && ['owner', 'admin', 'submitted'].includes(state.source)) {
      skipped.push({ field, reason: `protected:${state.source}` })
      continue
    }
    if (state?.source === 'enriched' || isEmptyValue(baseValues[field])) {
      allowed[field] = value
      continue
    }

    skipped.push({
      field,
      reason: `protected:${state?.source ?? 'unclassified'}`,
    })
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
