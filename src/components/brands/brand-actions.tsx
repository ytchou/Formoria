'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ExternalLink } from 'lucide-react'
import { trackExternalLinkClicked } from '@/lib/analytics'
import type { BrandVisitLinkKind } from '@/lib/brands/link-fallback'
import {
  onlineStoreMessageKey,
  onlineStoreByKey,
  type OnlineStoreKey,
} from '@/lib/brands/online-stores'
import { ReportDialog } from '@/components/brands/report-dialog'
import { buttonVariants } from '@/components/ui/button'
import { SaveBrandButton } from './save-brand-button'
import { ShareDialog } from './share-dialog'

/**
 * The store's visit-label message key, relative to the `brandDetail`
 * namespace this component translates in.
 */
function visitLabelKey(key: OnlineStoreKey): string {
  return onlineStoreMessageKey(
    onlineStoreByKey[key].messageKeys.brandDetailAction,
    'brandDetail'
  )
}

// Spelled out one key per store on purpose: an `Object.fromEntries` build
// collapses to `{ [k: string]: string }`, which satisfies the Record below
// vacuously and lets a new store through unnoticed. The literal is what makes
// `satisfies` a real gate — adding a store to the registry breaks this line.
const PURCHASE_VISIT_LABEL_KEYS = {
  website: visitLabelKey('website'),
  pinkoi: visitLabelKey('pinkoi'),
  shopee: visitLabelKey('shopee'),
  myship: visitLabelKey('myship'),
} satisfies Record<OnlineStoreKey, string>

const VISIT_LABEL_KEYS = {
  ...PURCHASE_VISIT_LABEL_KEYS,
  instagram: 'actions.visitInstagram',
  threads: 'actions.visitThreads',
  facebook: 'actions.visitFacebook',
} satisfies Record<BrandVisitLinkKind, string>

interface BrandActionsProps {
  adminSlot?: ReactNode
  websiteUrl: string | null
  visitKind?: BrandVisitLinkKind
  brandSlug?: string
  brandId?: string
  brandName: string
  brandImageUrl?: string
  categoryLabel?: string | null
}

export function BrandActions({
  adminSlot,
  websiteUrl,
  visitKind = 'website',
  brandSlug = '',
  brandId,
  brandName,
  brandImageUrl,
  categoryLabel,
}: BrandActionsProps) {
  const t = useTranslations('brandDetail')
  const visitLabel = t(VISIT_LABEL_KEYS[visitKind])
  const handleWebsiteClick = () => {
    trackExternalLinkClicked(
      brandSlug,
      'website',
      typeof window !== 'undefined' ? window.location.pathname : '',
      'detail_page',
      brandId,
    )

  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {websiteUrl ? (
        <a
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'primary', width: 'full', className: 'sm:flex-1' })}
          data-ph-no-autocapture
          onClick={handleWebsiteClick}
        >
          <ExternalLink className="size-[15px]" />
          {visitLabel}
        </a>
      ) : (
        <span className={buttonVariants({ variant: 'secondary', width: 'full', className: 'cursor-default opacity-50 sm:flex-1' })} aria-disabled="true">
          <ExternalLink className="size-[15px]" />
          <span className="line-through">{visitLabel}</span>
        </span>
      )}
      {/*
        The visit CTA and this secondary group share one row from `sm` up (the
        CTA takes the remaining width); below `sm` they stack, and the secondary
        buttons take the `compact` size's height and internal gap with padding
        one step tighter than compact so the group fits a 390px viewport.
        `flex-nowrap` holds the line rather than silently wrapping again.
      */}
      <div className="flex flex-nowrap gap-2 sm:shrink-0 max-sm:gap-1 max-sm:[&_button]:h-10 max-sm:[&_button]:gap-1 max-sm:[&_button]:px-2.5">
        <ShareDialog
          brandSlug={brandSlug}
          brandName={brandName}
          brandId={brandId}
          brandImageUrl={brandImageUrl}
          categoryLabel={categoryLabel}
        />
        {brandId && <SaveBrandButton brandId={brandId} slug={brandSlug} variant="inline" className="rounded-control" />}
        {brandId && <ReportDialog brandId={brandId} brandSlug={brandSlug} />}
        {adminSlot}
      </div>
    </div>
  )
}
