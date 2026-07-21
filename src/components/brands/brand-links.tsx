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
  ShoppingCart,
  Store,
} from 'lucide-react'
import { InstagramIcon } from '@/components/icons/instagram-icon'
import { buttonVariants } from '@/components/ui/button'
import type { Brand } from '@/lib/types'
import { cn } from '@/lib/utils'
import { trackExternalLinkClicked } from '@/lib/analytics'

interface BrandLinksProps {
  brand: Brand
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
  | 'instagram'
  | 'threads'
  | 'facebook'
  | 'website'
  | 'pinkoi'
  | 'shopee'

type LinkSlot = {
  label: string
  url: string | null
  linkType: LinkDestination | 'other'
  icon: ReactNode
  accentClassName?: string
}

type LinkSectionProps = {
  label: string
  slots: LinkSlot[]
  brand: Brand
}

const destinationLinkClassName =
  buttonVariants({
    variant: 'secondary',
    shape: 'pill',
    size: 'compact',
    className: 'min-w-32 max-w-full justify-center gap-2',
  })

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
    <h2 className="mb-3 type-section-title">
      {children}
    </h2>
  )
}

function LinkSection({ label, slots, brand }: LinkSectionProps) {
  const visibleSlots = slots.filter((slot) => slot.url)
  if (visibleSlots.length === 0) return null

  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex flex-wrap gap-3">
        {visibleSlots.map((slot, index) => {
          const slotKey = `${slot.linkType}:${slot.label}:${index}`

          return (
            <a
              key={slotKey}
              href={slot.url!}
              target="_blank"
              rel="noopener noreferrer"
              className={destinationLinkClassName}
              data-ph-no-autocapture
              onClick={() => {
                trackExternalLinkClicked(
                  brand.slug,
                  slot.linkType,
                  typeof window !== 'undefined' ? window.location.pathname : '',
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
    </section>
  )
}

function BrandSocialLinks({ brand }: BrandLinksProps) {
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
      label={t('links.socialPlatforms')}
      slots={socialSlots}
      brand={brand}
    />
  )
}

function BrandPurchaseLinks({ brand }: BrandLinksProps) {
  const t = useTranslations('brandDetail')

  const purchaseSlots: LinkSlot[] = [
    {
      label: t('links.website'),
      url: normalizeDirectUrl(brand.purchaseWebsite),
      linkType: 'website',
      icon: <Globe className="size-4 text-current" />,
      accentClassName: 'text-primary',
    },
    {
      label: t('links.pinkoi'),
      url: normalizeDirectUrl(brand.purchasePinkoi),
      linkType: 'pinkoi',
      icon: <Store className="size-4 text-current" />,
      accentClassName: 'text-[#E05B6F]',
    },
    {
      label: t('links.shopee'),
      url: normalizeDirectUrl(brand.purchaseShopee),
      linkType: 'shopee',
      icon: <ShoppingCart className="size-4 text-current" />,
      accentClassName: 'text-[#EE4D2D]',
    },
  ]

  return (
    <LinkSection
      label={t('links.purchaseChannels')}
      slots={purchaseSlots}
      brand={brand}
    />
  )
}

function BrandOtherLinks({ brand }: BrandLinksProps) {
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
    />
  )
}

export function BrandLinks({ brand }: BrandLinksProps) {
  return (
    <div className="space-y-5">
      <BrandSocialLinks brand={brand} />
      <BrandPurchaseLinks brand={brand} />
      <BrandOtherLinks brand={brand} />
    </div>
  )
}
