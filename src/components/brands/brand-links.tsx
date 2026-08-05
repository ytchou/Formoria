'use client'

import { useTranslations } from 'next-intl'
import {
  normalizeInstagramHref,
  normalizeThreadsHref,
  sanitizeHref,
} from '@/lib/url'
import type { ReactNode } from 'react'
import {
  AtSign,
  Globe,
  Link,
  Package,
  ShoppingCart,
  Store,
} from 'lucide-react'
import { InstagramIcon } from '@/components/icons/instagram-icon'
import { buttonVariants } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Brand } from '@/lib/types'
import {
  PURCHASE_CHANNELS,
  type PurchaseChannelColumn,
  type PurchaseChannelKey,
} from '@/lib/brands/purchase-channels'
import { cn } from '@/lib/utils'
import { trackExternalLinkClicked } from '@/lib/analytics'
import { CorrectionDialog } from './correction-dialog'

interface BrandLinksProps {
  brand: Brand
  sectionIds?: {
    social?: string
    purchase?: string
  }
  sectionClassName?: string
}

function normalizeDirectUrl(value: string | undefined | null): string | null {
  return sanitizeHref(value)
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M14 8h3V4h-3c-3.31 0-5 1.96-5 5v2H6v4h3v7h4v-7h3.24L17 11h-4V9c0-.68.32-1 1-1z" />
    </svg>
  )
}

type LinkDestination =
  | PurchaseChannelKey
  | 'instagram'
  | 'threads'
  | 'facebook'

type LinkSlot = {
  label: string
  url: string | null
  linkType: LinkDestination | 'other'
  icon: ReactNode
  accentClassName?: string
}

type LinkSectionProps = {
  id?: string
  label: string
  slots: LinkSlot[]
  brand: Brand
  className?: string
  headerAction?: ReactNode
}

const destinationLinkClassName =
  buttonVariants({
    variant: 'secondary',
    shape: 'pill',
    size: 'compact',
    className: 'min-w-32 max-w-full justify-center gap-2',
  })

const PURCHASE_PRESENTATION = {
  website: {
    icon: <Globe className="size-4 text-current" />,
    accentClassName: 'text-primary',
  },
  pinkoi: {
    icon: <Store className="size-4 text-current" />,
    accentClassName: 'text-[#E05B6F]',
  },
  shopee: {
    icon: <ShoppingCart className="size-4 text-current" />,
    accentClassName: 'text-[#EE4D2D]',
  },
  myship: {
    icon: <Package className="size-4 text-current" />,
    accentClassName: 'text-[#FF6600]',
  },
} satisfies Record<PurchaseChannelKey, { icon: ReactNode; accentClassName: string }>

function DestinationLinkButton({
  slot,
  children,
}: {
  slot: LinkSlot
  children: ReactNode
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn('flex size-4 shrink-0 items-center justify-center', slot.accentClassName)}
      >
        {slot.icon}
      </span>
      <span className="min-w-0 truncate">
        {children}
      </span>
    </>
  )
}

function SectionLabel({
  children,
}: {
  children: ReactNode
}) {
  return (
    <h2 className="type-section-title-large">
      {children}
    </h2>
  )
}

function LinkSection({
  id,
  label,
  slots,
  brand,
  className,
  headerAction,
}: LinkSectionProps) {
  const t = useTranslations('brandDetail')
  if (slots.length === 0 && !headerAction) return null

  return (
    <section id={id} className={className}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <SectionLabel>{label}</SectionLabel>
        {headerAction}
      </div>
      <TooltipProvider>
        <div className="flex flex-wrap gap-3">
          {slots.map((slot, index) => {
            const slotKey = `${slot.linkType}:${slot.label}:${index}`

            // A destination we hold no URL for stays on screen as an inert,
            // dimmed chip: the set of channels a brand could be on is itself
            // useful, and hiding the gap reads as "not on Instagram" rather
            // than "we do not know".
            if (!slot.url) {
              return (
                <Tooltip key={slotKey}>
                  <TooltipTrigger
                    type="button"
                    aria-disabled="true"
                    aria-label={`${slot.label} — ${t('links.unknown')}`}
                    onClick={(event) => event.preventDefault()}
                    className={cn(
                      destinationLinkClassName,
                      'cursor-not-allowed opacity-50',
                    )}
                    data-ph-no-autocapture
                  >
                    <DestinationLinkButton slot={slot}>
                      {slot.label}
                    </DestinationLinkButton>
                  </TooltipTrigger>
                  <TooltipContent>{t('links.unknown')}</TooltipContent>
                </Tooltip>
              )
            }

            return (
              <a
                key={slotKey}
                href={slot.url}
                target="_blank"
                rel="noopener noreferrer"
                className={destinationLinkClassName}
                data-ph-no-autocapture
                onClick={() => {
                  trackExternalLinkClicked(
                    brand.slug,
                    slot.linkType,
                    typeof window !== 'undefined' ? window.location.pathname : '',
                    'detail_page',
                    brand.id,
                  )
                }}
              >
                <DestinationLinkButton slot={slot}>
                  {slot.label}
                </DestinationLinkButton>
              </a>
            )
          })}
        </div>
      </TooltipProvider>
    </section>
  )
}

function BrandSocialLinks({ brand, sectionIds, sectionClassName }: BrandLinksProps) {
  const t = useTranslations('brandDetail')

  const socialSlots: LinkSlot[] = [
    {
      label: t('links.instagram'),
      url: normalizeInstagramHref(brand.socialInstagram),
      linkType: 'instagram',
      icon: <InstagramIcon className="size-4 text-current" />,
      accentClassName: 'text-[#E1306C]',
    },
    {
      label: t('links.threads'),
      url: normalizeThreadsHref(brand.socialThreads),
      linkType: 'threads',
      icon: <AtSign className="size-4 text-current" />,
    },
    {
      label: t('links.facebook'),
      url: normalizeDirectUrl(brand.socialFacebook),
      linkType: 'facebook',
      icon: <FacebookIcon className="size-4 text-current" />,
      accentClassName: 'text-[#1877F2]',
    },
  ]

  return (
    <LinkSection
      id={sectionIds?.social}
      label={t('links.socialPlatforms')}
      slots={socialSlots}
      brand={brand}
      className={sectionClassName}
      headerAction={
        <CorrectionDialog
          mode="socialLinks"
          brandId={brand.id}
          brandSlug={brand.slug}
          socialInstagram={brand.socialInstagram}
          socialThreads={brand.socialThreads}
          socialFacebook={brand.socialFacebook}
        />
      }
    />
  )
}

function BrandPurchaseLinks({ brand, sectionIds, sectionClassName }: BrandLinksProps) {
  const t = useTranslations('brandDetail')

  const purchaseSlots: LinkSlot[] = PURCHASE_CHANNELS.map((channel) => ({
    label: t(channel.messageKeys.brandDetailLink.replace(/^brandDetail\./, '')),
    url: normalizeDirectUrl(brand[channel.camel]),
    linkType: channel.key,
    ...PURCHASE_PRESENTATION[channel.key],
  }))
  const purchaseLinks = Object.fromEntries(
    PURCHASE_CHANNELS.map((channel) => [channel.column, brand[channel.camel]]),
  ) as Record<PurchaseChannelColumn, string | null>

  return (
    <LinkSection
      id={sectionIds?.purchase}
      label={t('links.purchaseChannels')}
      slots={purchaseSlots}
      brand={brand}
      className={sectionClassName}
      headerAction={
        <CorrectionDialog
          mode="purchaseLinks"
          brandId={brand.id}
          brandSlug={brand.slug}
          purchaseLinks={purchaseLinks}
        />
      }
    />
  )
}

function BrandOtherLinks({ brand, sectionClassName }: BrandLinksProps) {
  const t = useTranslations('brandDetail')

  const otherSlots: LinkSlot[] = brand.otherUrls.flatMap((otherUrl) => {
    const label = otherUrl.label?.trim() ?? ''
    const url = normalizeDirectUrl(otherUrl.url)
    if (!label || !url) return []

    return [
      {
        label,
        url,
        linkType: 'other',
        icon: <Link className="size-4 text-current" />,
      },
    ]
  })

  return (
    <LinkSection
      label={t('links.otherLinks')}
      slots={otherSlots}
      brand={brand}
      className={sectionClassName}
    />
  )
}

export function BrandLinks({ brand, sectionIds, sectionClassName }: BrandLinksProps) {
  return (
    <>
      <BrandSocialLinks
        brand={brand}
        sectionIds={sectionIds}
        sectionClassName={sectionClassName}
      />
      <BrandPurchaseLinks
        brand={brand}
        sectionIds={sectionIds}
        sectionClassName={sectionClassName}
      />
      <BrandOtherLinks brand={brand} sectionClassName={sectionClassName} />
    </>
  )
}
