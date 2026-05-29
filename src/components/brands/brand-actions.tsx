'use client'

import Link from 'next/link'
import { ExternalLink, Share2 } from 'lucide-react'
import { trackExternalLinkClicked, trackBrandPageShared } from '@/lib/analytics'
import { ReportDialog } from '@/components/brands/report-dialog'

interface BrandActionsProps {
  websiteUrl: string | null
  brandSlug?: string
  brandId?: string
}

export function BrandActions({ websiteUrl, brandSlug = '', brandId }: BrandActionsProps) {
  return (
    <>
      <div className="flex gap-2">
        {websiteUrl && (
          <Link
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-cta text-sm font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
            onClick={() =>
              trackExternalLinkClicked(
                brandSlug,
                'website',
                typeof window !== 'undefined' ? window.location.pathname : ''
              )
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
        {brandId && <ReportDialog brandId={brandId} brandSlug={brandSlug} />}
      </div>
      {websiteUrl && (
        <div
          data-testid="mobile-cta-bar"
          className="lg:hidden fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background px-4 py-3 pb-[env(safe-area-inset-bottom,0.75rem)]"
        >
          <Link
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="前往品牌官網"
            onClick={() =>
              trackExternalLinkClicked(brandSlug, 'website', typeof window !== 'undefined' ? window.location.pathname : '')
            }
            className="flex h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-cta text-sm font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
          >
            前往官網 <ExternalLink size={14} />
          </Link>
        </div>
      )}
    </>
  )
}
