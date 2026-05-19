'use client'

import { usePostHog } from 'posthog-js/react'
import { ExternalLink, Globe } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { ThreadsIcon } from '@/components/icons/threads-icon'
import type { Brand } from '@/lib/types'

type LinkType = 'social' | 'purchase'

interface BrandLinksProps {
  brand: Brand
}

export function BrandLinks({ brand }: BrandLinksProps) {
  const posthog = usePostHog()
  const links: {
    label: string
    url: string
    icon: 'globe' | 'external' | 'threads'
    type: LinkType
  }[] = []

  if (brand.socialLinks.officialWebsite) {
    links.push({
      label: 'Website',
      url: brand.socialLinks.officialWebsite,
      icon: 'globe',
      type: 'social',
    })
  }
  if (brand.socialLinks.instagram) {
    links.push({
      label: 'Instagram',
      url: brand.socialLinks.instagram,
      icon: 'external',
      type: 'social',
    })
  }
  if (brand.socialLinks.facebook) {
    links.push({
      label: 'Facebook',
      url: brand.socialLinks.facebook,
      icon: 'external',
      type: 'social',
    })
  }
  if (brand.socialLinks.threads) {
    links.push({
      label: 'Threads',
      url: brand.socialLinks.threads,
      icon: 'threads',
      type: 'social',
    })
  }
  for (const link of brand.purchaseLinks) {
    links.push({ label: link.label, url: link.url, icon: 'external', type: 'purchase' })
  }

  if (links.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 font-[family-name:var(--font-heading)] text-lg font-bold text-foreground">
        Find Them
      </h2>
      <div className="flex flex-wrap gap-2">
        {links.map((link, i) => (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            onClick={() => {
              posthog.capture('outbound_link_clicked', {
                brand_slug: brand.slug,
                platform: link.label.toLowerCase(),
                link_type: link.type,
              })
            }}
          >
            {link.icon === 'globe' ? (
              <Globe className="size-3.5" />
            ) : link.icon === 'threads' ? (
              <ThreadsIcon className="size-3.5" />
            ) : (
              <ExternalLink className="size-3.5" />
            )}
            {link.label}
          </a>
        ))}
      </div>
    </section>
  )
}
