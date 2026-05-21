'use client'

import { ExternalLink, Globe } from 'lucide-react'
import { ThreadsIcon } from '@/components/icons/threads-icon'
import type { Brand } from '@/lib/types'

type LinkType = 'social' | 'purchase'

interface BrandLinksProps {
  brand: Brand
}

export function BrandLinks({ brand }: BrandLinksProps) {
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
    links.push({
      label: link.label,
      url: link.url,
      icon: 'external',
      type: 'purchase',
    })
  }

  if (links.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        Find Them
      </h2>
      <div className="flex flex-wrap gap-3">
        {links.map((link, i) => (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
          >
            {link.icon === 'globe' ? (
              <Globe className="size-3.5 text-coffee" />
            ) : link.icon === 'threads' ? (
              <ThreadsIcon className="size-3.5 text-coffee" />
            ) : (
              <ExternalLink className="size-3.5 text-coffee" />
            )}
            {link.label}
          </a>
        ))}
      </div>
    </section>
  )
}
