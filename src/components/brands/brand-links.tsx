'use client'

import { useTranslations } from 'next-intl'
import { sanitizeHref } from '@/lib/url'
import type { ReactNode } from 'react'
import {
  AtSign,
  Globe,
  Link,
  ShoppingBag,
  ShoppingCart,
  Store,
  Users,
} from 'lucide-react'
import { InstagramIcon } from '@/components/icons/instagram-icon'
import type { Brand } from '@/lib/types'
import {
  trackDbClick,
  trackExternalLinkClicked,
} from '@/lib/analytics'

interface BrandLinksProps {
  brand: Brand
}

function normalizeInstagramUrl(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  return `https://instagram.com/${handle}`
}

function normalizeThreadsUrl(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  return `https://threads.net/@${handle}`
}

function normalizeWebsiteUrl(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
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
  dbDestination?: LinkDestination
  icon: ReactNode
}

type LinkSectionProps = {
  label: string
  icon: ReactNode
  slots: LinkSlot[]
  brand: Brand
}

const chipClassName =
  'inline-flex min-h-12 min-w-32 items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

const disabledChipClassName =
  'inline-flex min-h-12 min-w-32 items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-medium text-foreground opacity-45'

function SectionLabel({
  children,
}: {
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <h2 className="mb-3 font-heading text-base font-bold text-foreground">
      {children}
    </h2>
  )
}

function LinkSection({ label, icon, slots, brand }: LinkSectionProps) {
  return (
    <section>
      <SectionLabel icon={icon}>{label}</SectionLabel>
      <div className="flex flex-wrap gap-3">
        {slots.map((slot) => {
          if (slot.url) {
            return (
              <a
                key={slot.label}
                href={slot.url}
                target="_blank"
                rel="noopener noreferrer"
                className={chipClassName}
                onClick={() => {
                  trackExternalLinkClicked(
                    brand.slug,
                    slot.linkType,
                    typeof window !== 'undefined' ? window.location.pathname : '',
                  )
                  if (slot.dbDestination) {
                    trackDbClick(brand.id, slot.dbDestination)
                  }
                }}
              >
                {slot.icon}
                {slot.label}
              </a>
            )
          }

          return (
            <span
              key={slot.label}
              aria-disabled="true"
              className={disabledChipClassName}
            >
              {slot.icon}
              <span className="line-through">{slot.label}</span>
            </span>
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
      url: normalizeInstagramUrl(brand.socialInstagram),
      linkType: 'instagram',
      dbDestination: 'instagram',
      icon: <InstagramIcon className="size-4 text-foreground" />,
    },
    {
      label: t('links.threads'),
      url: normalizeThreadsUrl(brand.socialThreads),
      linkType: 'threads',
      dbDestination: 'threads',
      icon: <AtSign className="size-4 text-foreground" />,
    },
    {
      label: t('links.facebook'),
      url: normalizeDirectUrl(brand.socialFacebook),
      linkType: 'facebook',
      dbDestination: 'facebook',
      icon: <FacebookIcon className="size-4 text-foreground" />,
    },
  ]

  return (
    <LinkSection
      label={t('links.socialPlatforms')}
      icon={<Users className="size-3.5 text-warm-caption" />}
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
      url: normalizeWebsiteUrl(brand.purchaseWebsite),
      linkType: 'website',
      dbDestination: 'website',
      icon: <Globe className="size-4 text-foreground" />,
    },
    {
      label: t('links.pinkoi'),
      url: normalizeDirectUrl(brand.purchasePinkoi),
      linkType: 'pinkoi',
      dbDestination: 'pinkoi',
      icon: <Store className="size-4 text-[#E05B6F]" />,
    },
    {
      label: t('links.shopee'),
      url: normalizeDirectUrl(brand.purchaseShopee),
      linkType: 'shopee',
      dbDestination: 'shopee',
      icon: <ShoppingCart className="size-4 text-[#EE4D2D]" />,
    },
  ]

  return (
    <LinkSection
      label={t('links.purchaseChannels')}
      icon={<ShoppingBag className="size-3.5 text-warm-caption" />}
      slots={purchaseSlots}
      brand={brand}
    />
  )
}

function BrandOtherLinks({ brand }: BrandLinksProps) {
  const t = useTranslations('brandDetail')

  const otherSlots: LinkSlot[] = brand.otherUrls.map((otherUrl) => ({
    label: otherUrl.label,
    url: normalizeDirectUrl(otherUrl.url),
    linkType: 'other',
    icon: <Link className="size-4 text-foreground" />,
  }))

  if (otherSlots.length === 0) return null

  return (
    <LinkSection
      label={t('links.otherLinks')}
      icon={<Link className="size-3.5 text-warm-caption" />}
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
