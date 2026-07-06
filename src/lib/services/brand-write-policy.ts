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
