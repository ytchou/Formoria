import { createServiceClient } from '@/lib/supabase/server'
import { SECTION_TO_ONBOARDING_STEPS } from '@/lib/schemas/brand-edit'

export const ONBOARDING_STEPS = [
  'brand_basics',
  'media_links',
  'analytics',
  'health',
  'verification',
] as const

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]
export type OnboardingStepStatus = 'not_started' | 'in_progress' | 'complete'

export type OnboardingStep = {
  key: OnboardingStepKey
  status: OnboardingStepStatus
}

export type BrandOnboardingProgress = {
  steps: OnboardingStep[]
  completedCount: number
  isComplete: boolean
  nextStep: OnboardingStepKey | null
}

type ProgressRow = {
  step_key: string
  status: string
}

function isOnboardingInfraError(error: { code?: string }): boolean {
  // 42P01 = table doesn't exist, PGRST205 = PostgREST missing table,
  // 23514 = CHECK constraint violation (step keys not yet migrated)
  return error.code === '42P01' || error.code === 'PGRST205' || error.code === '23514'
}

export function isOnboardingStepKey(value: string): value is OnboardingStepKey {
  return ONBOARDING_STEPS.includes(value as OnboardingStepKey)
}

export function buildOnboardingProgress(rows: ProgressRow[]): BrandOnboardingProgress {
  const statuses = new Map(
    rows
      .filter((row) => isOnboardingStepKey(row.step_key))
      .map((row) => [row.step_key, row.status])
  )
  const steps = ONBOARDING_STEPS.map((key) => ({
    key,
    status: statuses.get(key) === 'complete'
      ? 'complete' as const
      : statuses.get(key) === 'in_progress'
        ? 'in_progress' as const
        : 'not_started' as const,
  }))
  const completedCount = steps.filter((step) => step.status === 'complete').length

  return {
    steps,
    completedCount,
    isComplete: completedCount === ONBOARDING_STEPS.length,
    nextStep: steps.find((step) => step.status !== 'complete')?.key ?? null,
  }
}

export async function getBrandOnboardingProgress(
  brandId: string
): Promise<BrandOnboardingProgress> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_onboarding_steps')
    .select('step_key, status')
    .eq('brand_id', brandId)

  if (error) {
    if (isOnboardingInfraError(error)) {
      return buildOnboardingProgress([])
    }
    throw error
  }
  return buildOnboardingProgress((data ?? []) as ProgressRow[])
}

export async function setBrandOnboardingStepStatus({
  brandId,
  userId,
  step,
  status,
}: {
  brandId: string
  userId: string
  step: OnboardingStepKey
  status: Exclude<OnboardingStepStatus, 'not_started'>
}): Promise<void> {
  const now = new Date().toISOString()
  const supabase = createServiceClient()

  // Check for existing row to prevent timestamp destruction and status regressions
  const { data: existing, error: fetchError } = await supabase
    .from('brand_onboarding_steps')
    .select('status, started_at')
    .eq('brand_id', brandId)
    .eq('step_key', step)
    .maybeSingle()

  if (fetchError) {
    if (isOnboardingInfraError(fetchError)) return
    throw fetchError
  }

  // Bug 2: Never regress from 'complete' to a lower status
  if (existing?.status === 'complete') {
    return
  }

  const { error } = await supabase
    .from('brand_onboarding_steps')
    .upsert({
      brand_id: brandId,
      step_key: step,
      status,
      started_at: existing?.started_at ?? now, // Bug 1: only set on first insert
      completed_at: status === 'complete' ? now : null,
      completed_by_user_id: status === 'complete' ? userId : null, // Bug 3: only set on complete
      updated_at: now,
    }, { onConflict: 'brand_id,step_key' })

  if (error && !isOnboardingInfraError(error)) throw error
}

async function markOnboardingStepCompleted(
  brandId: string,
  step: OnboardingStepKey
): Promise<void> {
  const supabase = createServiceClient()
  const { data: owner, error: ownerError } = await supabase
    .from('brand_owners')
    .select('user_id')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (ownerError) throw ownerError
  if (!owner?.user_id) throw new Error(`No owner found for brand ${brandId}`)

  await setBrandOnboardingStepStatus({
    brandId,
    userId: owner.user_id,
    step,
    status: 'complete',
  })
}

export async function completeOnboardingStepsForSection(
  brandId: string,
  sectionKey: string
): Promise<void> {
  const steps = SECTION_TO_ONBOARDING_STEPS[sectionKey]
  if (!steps || steps.length === 0) return
  await Promise.all(steps.map(step => markOnboardingStepCompleted(brandId, step)))
}
