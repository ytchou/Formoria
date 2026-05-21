import Link from 'next/link'
import { ExternalLink, Share2, Bookmark, Flag } from 'lucide-react'

interface BrandActionsProps {
  websiteUrl: string | null
}

export function BrandActions({ websiteUrl }: BrandActionsProps) {
  return (
    <div className="flex gap-2">
      {websiteUrl && (
        <Link
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-terracotta text-sm font-semibold text-white transition-colors hover:bg-terracotta/90"
        >
          <ExternalLink className="size-[15px]" />
          Visit Website
        </Link>
      )}
      <button
        type="button"
        className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors hover:bg-secondary/80"
        aria-label="Share"
      >
        <Share2 className="size-[17px]" />
      </button>
      <button
        type="button"
        className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors hover:bg-secondary/80"
        aria-label="Bookmark"
      >
        <Bookmark className="size-[17px]" />
      </button>
      <button
        type="button"
        className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors hover:bg-secondary/80"
        aria-label="Report"
      >
        <Flag className="size-[17px]" />
      </button>
    </div>
  )
}
