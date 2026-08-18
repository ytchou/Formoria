import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { localizePath, signInHref } from '@/i18n/locale-preference'
import { getTranslations } from 'next-intl/server'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { getBrandDraft, toOwnerEditorContract } from '@/lib/services/brands'
import { getApprovedSubcategorySuggestions } from '@/lib/services/subcategory-suggestions'
import { BrandEditWizard } from './brand-edit-wizard'
import {
  buildBrandEditDefaultValues,
  getCompletedWizardSteps,
  getInitialWizardStep,
} from './brand-edit-defaults'
import {
  areAllWizardStepsComplete,
  WIZARD_STEPS,
} from '@/lib/schemas/brand-edit'

type Props = {
  params: Promise<{ slug: string; locale: string }>
  searchParams: Promise<{ step?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'dashboard.edit' })
  return { title: t('metaTitle') }
}

export default async function BrandEditPage({ params, searchParams }: Props) {
  const { slug, locale } = await params
  const { step: rawStep } = await searchParams

  const editor = await requireBrandEditor(slug, {
    includeRomanizedName: true,
  })
  if ('error' in editor) {
    redirect(
      editor.error === 'notLoggedIn'
        ? signInHref(`/dashboard/brands/${slug}/edit`, locale)
        : localizePath('/dashboard', locale),
    )
    return null
  }
  const brand = toOwnerEditorContract(editor.brand)

  const [draft, subcategorySuggestions] = await Promise.all([
    getBrandDraft(brand.id),
    getApprovedSubcategorySuggestions(),
  ])

  const defaultValues = buildBrandEditDefaultValues(brand, draft)
  const initialCompletedSteps = getCompletedWizardSteps(draft)
  const isWizardComplete = areAllWizardStepsComplete(
    initialCompletedSteps,
    WIZARD_STEPS.length,
  )

  const initialStep =
    !rawStep && isWizardComplete
      ? 0
      : getInitialWizardStep(
          rawStep,
          initialCompletedSteps,
          WIZARD_STEPS.length,
        )

  const t = await getTranslations('dashboard.edit')

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="type-section-title-large">
          {t('pageHeading', { name: brand.name })}
        </h1>
        <p className="mt-1 type-card-description">
          {t('pageSubheading')}
        </p>
      </div>

      <BrandEditWizard
        brand={brand}
        defaultValues={defaultValues}
        initialCompletedSteps={initialCompletedSteps}
        initialStep={initialStep}
        isFocused={isWizardComplete}
        subcategorySuggestions={subcategorySuggestions}
      />
    </div>
  )
}
