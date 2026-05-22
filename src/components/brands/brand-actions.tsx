'use client'

import Link from 'next/link'
import { ExternalLink, Share2, Bookmark, Flag } from 'lucide-react'
import { trackExternalLinkClicked, trackBrandPageShared } from '@/lib/analytics'

interface BrandActionsProps {
  websiteUrl: string | null
  brandSlug?: string
}

export function BrandActions({ websiteUrl, brandSlug = '' }: BrandActionsProps) {
  return (
    <div className="flex gap-2">
      {websiteUrl && (
        <Link
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-terracotta text-sm font-semibold text-white transition-colors hover:bg-terracotta/90"
          onClick={() =>
            trackExternalLinkClicked(brandSlug, 'website', typeof window !== 'undefined' ? window.location.pathname : '')
          }
        >
          <ExternalLink className="size-[15px]" />
          前往官網
        </Link>
      )}
      <button
        type="button"
        className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors hover:bg-secondary/80"
        aria-label="分享"
        onClick={() => trackBrandPageShared(brandSlug)}
      >
        <Share2 className="size-[17px]" />
      </button>
      <button
        type="button"
        className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors hover:bg-secondary/80"
        aria-label="收藏"
      >
        <Bookmark className="size-[17px]" />
      </button>
      <button
        type="button"
        className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors hover:bg-secondary/80"
        aria-label="檢舉"
      >
        <Flag className="size-[17px]" />
      </button>
    </div>
  )
}
