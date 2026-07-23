import { getTranslations, setRequestLocale } from 'next-intl/server'
import { InlineVerification } from '@/components/dashboard/inline-verification'
import { SectionDetailLayout } from '@/components/dashboard/section-detail-layout'
import { getBrandBySlug } from '@/lib/services/brands'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

export default async function VerificationPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const brand = await getBrandBySlug(slug)
  const t = await getTranslations({
    locale,
    namespace: 'dashboard.brandProfile',
  })

  return (
    <SectionDetailLayout
      description={t('sectionVerificationHint')}
      title={t('sectionVerification')}
    >
      <InlineVerification
        brandId={brand.id}
        embedded
        mitEvidence={brand.mitEvidence ?? undefined}
        mitStatus={brand.mitStatus ?? 'unverified'}
      />
    </SectionDetailLayout>
  )
}
