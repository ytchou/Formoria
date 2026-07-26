import { getTranslations } from 'next-intl/server'
import { SurfaceCard } from '@/components/ui/card'
import { CHANNEL_CONFIRMATION_THRESHOLD } from '@/lib/brands/channels'
import type { BrandChannel } from '@/lib/types'
import { BrandChannelList } from './brand-channel-list'
import { ProvideChannelInfoDialog } from './provide-channel-info-dialog'

export type BrandChannelsSectionProps = {
  confirmed: BrandChannel[]
  possible: BrandChannel[]
  brandId: string
  brandSlug: string
}

export async function BrandChannelsSection({
  confirmed,
  possible,
  brandId,
  brandSlug,
}: BrandChannelsSectionProps) {
  const t = await getTranslations('brandDetail')
  const hasChannels = confirmed.length > 0 || possible.length > 0

  return (
    <section
      className="space-y-6"
      data-brand-id={brandId}
      data-brand-slug={brandSlug}
      data-brand-channels-section
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h2 className="type-section-title-large">
            {t('sections.locationsAndRetailChannels')}
          </h2>
          <p className="type-card-description">
            {possible.length > 0
              ? t('channels.unconfirmed.thresholdNote', {
                  threshold: CHANNEL_CONFIRMATION_THRESHOLD,
                })
              : t('channels.subtitle')}
          </p>
        </div>
        <ProvideChannelInfoDialog brandId={brandId} brandSlug={brandSlug} />
      </div>

      {hasChannels ? (
        <BrandChannelList
          confirmed={confirmed}
          possible={possible}
          brandId={brandId}
          brandSlug={brandSlug}
          threshold={CHANNEL_CONFIRMATION_THRESHOLD}
        />
      ) : null}

      {!hasChannels ? (
        <SurfaceCard padding="lg" data-testid="brand-channels-empty-state">
          <h3 className="type-subsection-title">{t('channels.empty.title')}</h3>
          <p className="mt-1 type-card-description">
            {t('channels.empty.description')}
          </p>
          <div className="mt-4">
            <ProvideChannelInfoDialog brandId={brandId} brandSlug={brandSlug} />
          </div>
        </SurfaceCard>
      ) : null}
    </section>
  )
}
