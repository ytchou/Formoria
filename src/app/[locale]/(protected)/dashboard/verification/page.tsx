import { setRequestLocale } from 'next-intl/server'
import { MitStatusCard } from '@/components/dashboard/mit-status-card'
import { getBrandBySlug } from '@/lib/services/brands'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { createClient } from '@/lib/supabase/server'
import { resolveBrand } from '../_lib/resolve-brand'

type Props = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ brand?: string }>
}

export default async function VerificationPage({ params, searchParams }: Props) {
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

  const brand = await getBrandBySlug(selectedBrand.brandSlug)
  const ownerCheck = await isOwnerOf(user.id, brand.id)

  return (
    <MitStatusCard
      brandId={brand.id}
      brandName={brand.name}
      brandSlug={brand.slug}
      mitStatus={brand.mitStatus ?? 'unverified'}
      mitEvidence={brand.mitEvidence ?? undefined}
      isOwner={ownerCheck}
    />
  )
}
