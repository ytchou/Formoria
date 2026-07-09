'use client'

import { useTranslations } from 'next-intl'
import { ExternalLink } from 'lucide-react'
import {
  trackDbClick,
  trackExternalLinkClicked,
} from '@/lib/analytics'
import { ReportDialog } from '@/components/brands/report-dialog'
import { buttonVariants } from '@/components/ui/button'
import { SaveBrandButton } from './save-brand-button'
import { ShareDialog } from './share-dialog'

interface BrandActionsProps {
  websiteUrl: string | null
  brandSlug?: string
  brandId?: string
  brandName: string
}

const activeCta = buttonVariants({ variant: 'primary', tone: 'cta', className: 'flex-1' })
const disabledCta = buttonVariants({
  variant: 'secondary',
  className: 'flex-1 cursor-default opacity-50',
})

export function BrandActions({ websiteUrl, brandSlug = '', brandId, brandName }: BrandActionsProps) {
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
        {websiteUrl ? (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={activeCta}
            onClick={handleWebsiteClick}
          >
            <ExternalLink className="size-[15px]" />
            {t('actions.visitWebsite')}
          </a>
        ) : (
          <span className={disabledCta} aria-disabled="true">
            <ExternalLink className="size-[15px]" />
            <span className="line-through">{t('actions.visitWebsite')}</span>
          </span>
        )}
        <ShareDialog brandSlug={brandSlug} brandName={brandName} />
        {brandId && <SaveBrandButton brandId={brandId} variant="inline" className="rounded-xl" />}
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
            className={buttonVariants({ variant: 'primary', tone: 'cta', className: 'w-full' })}
          >
            {t('actions.visitWebsite')} <ExternalLink size={14} />
          </a>
        </div>
      )}
    </>
  )
}
