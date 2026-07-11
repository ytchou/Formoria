import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import type { AppLocale } from '@/i18n/locale-preference'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { resolveDashboardBrand } from '@/lib/services/resolve-dashboard-brand'

type Props = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('dashboard')

  return {
    title: t('metadata.title'),
  }
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ctx = user
    ? await resolveDashboardBrand(
        user.id,
        user.email ?? null,
        resolvedSearchParams.brand,
      )
    : null

  if (!ctx) {
    return null
  }

  redirect(localizePath(`/dashboard/brands/${ctx.brand.brandSlug}`, locale as AppLocale))
}
