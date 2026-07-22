import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { getTranslations } from 'next-intl/server'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { getBrandDraft } from '@/lib/services/brands'
import { getApprovedProductTagSuggestions } from '@/lib/services/product-tag-suggestions'
import { BrandEditWizard } from './brand-edit-wizard'
import {
  buildBrandEditDefaultValues,
  getCompletedWizardSteps,
  getInitialWizardStep,
} from './brand-edit-defaults'

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
        ? '/auth/sign-in'
        : localizePath('/dashboard', locale),
    )
    return null
  }
  const { brand, owner: isActualOwner } = editor

  const [draft, productTagSuggestions] = await Promise.all([
    getBrandDraft(brand.id),
    getApprovedProductTagSuggestions(),
  ])

  const defaultValues = buildBrandEditDefaultValues(brand, draft)
  const initialCompletedSteps = getCompletedWizardSteps(draft)

  const initialStep = getInitialWizardStep(rawStep, initialCompletedSteps, 5)

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
        isActualOwner={isActualOwner}
        productTagSuggestions={productTagSuggestions}
      />
    </div>
  )
}
