'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { getOnboardingStepHref } from '@/lib/schemas/brand-edit'
import {
  isOnboardingStepKey,
  setBrandOnboardingStepStatus,
  type OnboardingStepKey,
} from '@/lib/services/brand-onboarding'

export async function visitDashboardWalkthroughStep(
  brandId: string,
  brandSlug: string,
  step: OnboardingStepKey,
) {
  if (!isOnboardingStepKey(step)) return

  const editor = await requireBrandEditor(brandSlug)
  if ('error' in editor || editor.brand.id !== brandId) return

  await setBrandOnboardingStepStatus({
    brandId,
    userId: editor.user.id,
    step,
    status: 'complete',
  })
  revalidatePath(`/dashboard/brands/${brandSlug}`)
  redirect(getOnboardingStepHref(step, brandSlug))
}
