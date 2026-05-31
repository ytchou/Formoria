import { getTranslations } from 'next-intl/server'
import CtaSection from '@/components/shared/cta-section'

export default async function DualCta() {
  const t = await getTranslations('landing.dualCta')

  return (
    <CtaSection
      primaryLabel={t('primary')}
      primaryHref="/brands"
      secondaryLabel={t('secondary')}
      secondaryHref="/submit"
    />
  )
}
