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
import { routes } from '@/lib/routes'

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
        ? signInHref(routes.dashboard.brandEdit(slug), locale)
        : localizePath(routes.dashboard.index(), locale),
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
    <div className="w-full space-y-stack">
      <div>
        <h1 className="type-section">
          {t('pageHeading', { name: brand.name })}
        </h1>
        <p className="mt-1 type-body-sm">
          {t('pageSubheading')}
        </p>
      </div>

      {/*
        Two things this form never said out loud, stated before the owner
        starts editing rather than after they press publish.

        The first is what publishing does. `save` and `wizardPublish` were bare
        verbs, and an owner who does not know a moderation review sits between
        them and the live page reads the delay as the form having failed.

        The second is what this form does NOT control. Editorial product
        selection is an editorial decision and every write path behind it is
        admin-only — that was already true, and saying nothing about it just
        sent owners looking for a switch that does not exist. Stating it is the
        whole change.

        A bordered note on surface, not a dialog: neither sentence is a
        decision to confirm, and a dialog would be dismissed once and never
        read again. A plain `<div>`, not an `<aside>`: an unlabelled
        complementary landmark is noise to a screen reader, and the wizard
        sidebar below already owns the only `<aside>` on this page — which
        `dashboard-brand-owned-edit.spec.ts` selects by tag.
      */}
      <div className="space-y-2 rounded-surface border border-rule bg-surface p-4">
        <p className="type-body-sm text-ink-soft">{t('reviewNotice')}</p>
        <p className="type-body-sm text-ink-soft">{t('curationNotice')}</p>
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
