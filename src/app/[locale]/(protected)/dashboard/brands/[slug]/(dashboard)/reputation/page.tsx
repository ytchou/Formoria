import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SectionDetailLayout } from '@/components/dashboard/section-detail-layout'
import { EmptyValue, display } from '@/components/dashboard/display-helpers'
import { InfoField } from '@/components/ui/card'
import { getBrandBySlug } from '@/lib/services/brands'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

export default async function ReputationPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const brand = await getBrandBySlug(slug)
  const [t, tEdit] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard.brandProfile' }),
    getTranslations({ locale, namespace: 'dashboard.edit' }),
  ])

  return (
    <SectionDetailLayout
      description={t('sectionReputationHint')}
      editHref={`/dashboard/brands/${slug}/edit?step=4`}
      editLabel={t('edit')}
      title={tEdit('wizardStepReputation')}
    >
      <dl className="space-y-5">
        <InfoField
          label={tEdit('fieldReputationSummary')}
          value={display(brand.reputationSummary?.text, t('notSet'))}
          wide
        />
        <InfoField
          label={tEdit('fieldProvenanceSources')}
          value={
            brand.reputationSummary?.sources.length
              ? brand.reputationSummary.sources
                  .map(({ url }) => url)
                  .join('\n')
              : <EmptyValue>{t('notSet')}</EmptyValue>
          }
          wide
        />
      </dl>
    </SectionDetailLayout>
  )
}
