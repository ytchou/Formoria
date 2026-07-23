import { ExternalLink, MapPin, Monitor, Store } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'
import type { BrandChannel } from '@/lib/types'

export type BrandChannelsSectionProps = {
  confirmed: BrandChannel[]
  possible: BrandChannel[]
  brandId: string
  brandSlug: string
}

type ChannelTranslator = (key: string) => string

function ChannelRow({
  channel,
  t,
}: {
  channel: BrandChannel
  t: ChannelTranslator
}) {
  const isOnline = channel.channelType === 'online'
  const Icon = isOnline ? Monitor : Store
  const region = channel.regionLabel ?? channel.address
  const mapsHref = channel.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(channel.address)}`
    : null
  const provenance =
    channel.confirmedBy ??
    (channel.ownerStatus === 'confirmed' ? 'owner' : 'community')

  return (
    <div
      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
      data-channel-row
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0"
          data-channel-icon={isOnline ? 'monitor' : 'store'}
        />
        <div className="min-w-0">
          <p className="type-body-sm font-semibold">{channel.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="type-metadata">
              {t(
                isOnline
                  ? 'channels.dialog.channelTypeOnline'
                  : 'channels.dialog.channelTypeOffline',
              )}
            </span>
            {channel.categoryLabel ? (
              <Badge variant="secondary">{channel.categoryLabel}</Badge>
            ) : null}
          </div>
          {region ? (
            <div className="mt-2 type-body-sm">
              {mapsHref ? (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {region}
                </a>
              ) : (
                <span>{region}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        <Badge variant="success">
          {t(`channels.provenance.${provenance}`)}
        </Badge>
        {channel.url ? (
          <a
            href={channel.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({
              variant: 'secondary',
              size: 'compact',
              className: 'min-h-12',
            })}
          >
            {t(
              isOnline
                ? 'channels.confirmed.officialPageLink'
                : 'channels.confirmed.storeInfoLink',
            )}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

function ProvideInfoLink({
  brandId,
  brandSlug,
  children,
}: {
  brandId: string
  brandSlug: string
  children: string
}) {
  return (
    <a
      href="#provide-channel-info"
      className={buttonVariants({
        variant: 'secondary',
        className: 'min-h-12',
      })}
      data-brand-id={brandId}
      data-brand-slug={brandSlug}
      data-dialog-trigger="provide-channel-info"
    >
      {children}
    </a>
  )
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
          <div className="flex items-center gap-2">
            <MapPin aria-hidden="true" className="size-5 shrink-0" />
            <h2 className="type-card-title">
              {t('sections.locationsAndRetailChannels')}
            </h2>
          </div>
          <p className="type-card-description">{t('channels.subtitle')}</p>
        </div>
        <ProvideInfoLink brandId={brandId} brandSlug={brandSlug}>
          {t('channels.provideInfo')}
        </ProvideInfoLink>
      </div>

      {confirmed.length > 0 ? (
        <SurfaceCard
          tone="success"
          padding="lg"
          data-channel-group="confirmed"
        >
          <div>
            <h3 className="type-subsection-title">
              {t('channels.confirmed.heading')} ({confirmed.length})
            </h3>
            <p className="mt-1 type-card-description">
              {t('channels.confirmed.explainer')}
            </p>
          </div>
          <div className="mt-4 divide-y divide-border">
            {confirmed.map((channel) => (
              <ChannelRow channel={channel} key={channel.id} t={t} />
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      {possible.length > 0 ? (
        <SurfaceCard
          tone="warning"
          padding="lg"
          data-channel-group="possible"
        >
          <div>
            <h3 className="type-subsection-title">
              {t('channels.unconfirmed.heading')} ({possible.length})
            </h3>
            <p className="mt-1 type-card-description">
              {t('channels.unconfirmed.explainer')}
            </p>
          </div>
          <div
            className="mt-4"
            data-brand-id={brandId}
            data-brand-slug={brandSlug}
            data-channels={JSON.stringify(possible)}
            data-possible-channels="true"
          />
        </SurfaceCard>
      ) : null}

      {!hasChannels ? (
        <SurfaceCard padding="lg" data-testid="brand-channels-empty-state">
          <h3 className="type-subsection-title">{t('channels.empty.title')}</h3>
          <p className="mt-1 type-card-description">
            {t('channels.empty.description')}
          </p>
          <div className="mt-4">
            <ProvideInfoLink brandId={brandId} brandSlug={brandSlug}>
              {t('channels.empty.cta')}
            </ProvideInfoLink>
          </div>
        </SurfaceCard>
      ) : null}

      <div
        data-brand-id={brandId}
        data-brand-slug={brandSlug}
        data-owner-banner="true"
      />
    </section>
  )
}
