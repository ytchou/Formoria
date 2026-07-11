'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { getOnboardingStepHref } from '@/lib/schemas/brand-edit'
import { localizePath } from '@/i18n/locale-preference'
import type { AppLocale } from '@/i18n/locale-preference'
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
  const locale = await getLocale()
  redirect(localizePath(getOnboardingStepHref(step, brandSlug), locale as AppLocale))
}
