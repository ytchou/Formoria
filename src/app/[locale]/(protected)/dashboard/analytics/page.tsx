import { setRequestLocale } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { createClient } from '@/lib/supabase/server'
import { resolveBrand } from '../_lib/resolve-brand'

type Props = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

export default async function AnalyticsPage({ params, searchParams }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const selectedBrand = await resolveBrand(resolvedSearchParams, user.id, user.email)
  if (!selectedBrand) return null

  redirect(localizePath(`/dashboard/brands/${selectedBrand.brandSlug}/analytics`, locale))
}
