'use client'

import { useTranslations } from 'next-intl'
import { ExternalLink, Share2 } from 'lucide-react'
import {
  trackBrandPageShared,
  trackDbClick,
  trackExternalLinkClicked,
} from '@/lib/analytics'
import { ReportDialog } from '@/components/brands/report-dialog'
import { SaveBrandButton } from './save-brand-button'

interface BrandActionsProps {
  websiteUrl: string | null
  brandSlug?: string
  brandId?: string
}

export function BrandActions({ websiteUrl, brandSlug = '', brandId }: BrandActionsProps) {
  const t = useTranslations('brandDetail')
  const handleWebsiteClick = () => {
    trackExternalLinkClicked(
      brandSlug,
      'website',
      typeof window !== 'undefined' ? window.location.pathname : ''
    )

    if (brandId) {
      trackDbClick(brandId, 'official_website')
    }
  }

  return (
    <>
      <div className="flex gap-2">
        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-cta text-sm font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
            onClick={handleWebsiteClick}
          >
            <ExternalLink className="size-[15px]" />
            {t('actions.visitWebsite')}
          </a>
        )}
        <button
          type="button"
          className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors hover:bg-secondary/80"
          aria-label={t('actions.share')}
          onClick={() => trackBrandPageShared(brandSlug)}
        >
          <Share2 className="size-[17px]" />
        </button>
        {brandId && (
          <div className="[&>button]:h-[42px] [&>button]:rounded-xl">
            <SaveBrandButton brandId={brandId} variant="inline" />
          </div>
        )}
        {brandId && <ReportDialog brandId={brandId} brandSlug={brandSlug} />}
      </div>
      {websiteUrl && (
        <div
          data-testid="mobile-cta-bar"
          className="lg:hidden fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background px-4 py-3 pb-[env(safe-area-inset-bottom,0.75rem)]"
        >
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('actions.visitOfficialWebsiteAria')}
            onClick={handleWebsiteClick}
            className="flex h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-cta text-sm font-semibold text-cta-foreground transition-colors hover:bg-cta/90"
          >
            {t('actions.visitWebsite')} <ExternalLink size={14} />
          </a>
        </div>
      )}
    </>
  )
}
