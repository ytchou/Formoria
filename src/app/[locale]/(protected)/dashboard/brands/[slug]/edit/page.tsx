import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { canManageDashboardBrand } from '@/lib/auth/admin-mode'
import { getBrandBySlug, getBrandDraft } from '@/lib/services/brands'
import { getApprovedProductTagSuggestions } from '@/lib/services/product-tag-suggestions'
import { DraftBanner } from '../draft-banner'
import { BrandEditWizard } from './brand-edit-wizard'
import { buildBrandEditDefaultValues } from './brand-edit-defaults'

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
  const { slug } = await params
  const { step: rawStep } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/sign-in')

  const brand = await getBrandBySlug(slug)
  const owner = await canManageDashboardBrand(
    user.id,
    user.email,
    brand.id,
    brand.slug,
  )

  if (!owner) redirect('/dashboard')

  const [draft, productTagSuggestions] = await Promise.all([
    getBrandDraft(brand.id),
    getApprovedProductTagSuggestions(),
  ])

  const defaultValues = buildBrandEditDefaultValues(brand, draft?.data)

  let initialStep = 0
  if (rawStep) {
    initialStep = Math.max(0, Math.min(parseInt(rawStep, 10), 4))
  }

  const t = await getTranslations('dashboard.edit')

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="font-heading text-2xl font-bold tracking-tight">
        {t('pageHeading', { name: brand.name })}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('pageSubheading')}
      </p>

      <div className="mt-8">
        {draft ? (
          <div className="mb-8">
            <DraftBanner slug={brand.slug} draftUpdatedAt={null} />
          </div>
        ) : null}
        <BrandEditWizard
          brand={brand}
          defaultValues={defaultValues}
          initialStep={initialStep}
          productTagSuggestions={productTagSuggestions}
        />
      </div>
    </div>
  )
}
