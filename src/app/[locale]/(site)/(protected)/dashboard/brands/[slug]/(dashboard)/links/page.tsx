import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SectionDetailLayout } from '@/components/dashboard/section-detail-layout'
import { EmptyValue, display } from '@/components/dashboard/display-helpers'
import { InfoField } from '@/components/ui/card'
import { getBrandBySlug } from '@/lib/services/brands'
import {
  channelMessageKey,
  PURCHASE_CHANNELS,
} from '@/lib/brands/purchase-channels'

type Props = {
  params: Promise<{ locale: string; slug: string }>
}

export default async function LinksPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const brand = await getBrandBySlug(slug)
  const [t, tEdit] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard.brandProfile' }),
    getTranslations({ locale, namespace: 'dashboard.edit' }),
  ])
  return (
    <SectionDetailLayout
      description={t('sectionLinksHint')}
      editHref={`/dashboard/brands/${slug}/edit?step=2`}
      editLabel={t('edit')}
      title={tEdit('wizardStepLinks')}
    >
      <div className="space-y-8">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <InfoField
            label={tEdit('fieldInstagram')}
            value={display(brand.socialInstagram, t('notSet'))}
          />
          <InfoField
            label={tEdit('fieldThreads')}
            value={display(brand.socialThreads, t('notSet'))}
          />
          <InfoField
            label={tEdit('fieldFacebook')}
            value={display(brand.socialFacebook, t('notSet'))}
          />
          {PURCHASE_CHANNELS.map((channel) => (
            <InfoField
              key={channel.key}
              label={tEdit(
                channelMessageKey(
                  channel.messageKeys.dashboardEditField,
                  'dashboard.edit',
                ),
              )}
              value={display(brand[channel.camel], t('notSet'))}
            />
          ))}
          <InfoField
            label={tEdit('fieldOtherLinks')}
            value={
              brand.otherUrls.length > 0
                ? brand.otherUrls
                    .map(({ label, url }) => `${label}: ${url}`)
                    .join('\n')
                : <EmptyValue>{t('notSet')}</EmptyValue>
            }
            wide
          />
        </dl>

      </div>
    </SectionDetailLayout>
  )
}
