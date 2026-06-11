'use client'

import { useTranslations } from 'next-intl'
import { Globe } from 'lucide-react'
import { ThreadsIcon } from '@/components/icons/threads-icon'
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
  return `https://www.threads.net/@${handle}`
}

function normalizeWebsiteUrl(value: string | undefined | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

type SlotDef = {
  label: string
  url: string | null
  icon: 'instagram' | 'threads' | 'globe'
  type: 'instagram' | 'threads' | 'officialWebsite'
}

export function BrandLinks({ brand }: BrandLinksProps) {
  const t = useTranslations('brandDetail')

  const slots: SlotDef[] = [
    {
      label: 'Instagram',
      url: normalizeInstagramUrl(brand.socialLinks.instagram),
      icon: 'instagram',
      type: 'instagram',
    },
    {
      label: 'Threads',
      url: normalizeThreadsUrl(brand.socialLinks.threads),
      icon: 'threads',
      type: 'threads',
    },
    {
      label: 'Website',
      url: normalizeWebsiteUrl(brand.socialLinks.officialWebsite),
      icon: 'globe',
      type: 'officialWebsite',
    },
  ]

  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        {t('links.purchaseChannels')}
      </h2>
      <div className="flex flex-wrap gap-3">
        {slots.map((slot) => {
          const iconEl =
            slot.icon === 'instagram' ? (
              <InstagramIcon className="size-3.5" />
            ) : slot.icon === 'threads' ? (
              <ThreadsIcon className="size-3.5 text-foreground" />
            ) : (
              <Globe className="size-3.5 text-foreground" />
            )

          if (slot.url) {
            return (
              <a
                key={slot.label}
                href={slot.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
                onClick={() => {
                  trackExternalLinkClicked(
                    brand.slug,
                    slot.label.toLowerCase(),
                    typeof window !== 'undefined' ? window.location.pathname : '',
                  )
                  trackDbClick(brand.id, slot.type === 'officialWebsite' ? 'official_website' : slot.type)
                }}
              >
                {iconEl}
                {slot.label}
              </a>
            )
          }

          return (
            <span
              key={slot.label}
              aria-disabled="true"
              className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-3.5 py-2 text-sm font-medium text-muted-foreground cursor-not-allowed"
            >
              {iconEl}
              <span className="line-through decoration-muted-foreground/60">{slot.label}</span>
            </span>
          )
        })}
      </div>
    </section>
  )
}
