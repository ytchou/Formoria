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
import { LikeBrandButton } from './like-brand-button'
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
    <div className="space-y-3">
      {websiteUrl ? (
        <a
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'primary', className: 'w-full' })}
          data-ph-no-autocapture
          onClick={handleWebsiteClick}
        >
          <ExternalLink className="size-[15px]" />
          {visitLabel}
        </a>
      ) : (
        <span className={buttonVariants({ variant: 'secondary', className: 'w-full cursor-default opacity-50' })} aria-disabled="true">
          <ExternalLink className="size-[15px]" />
          <span className="line-through">{visitLabel}</span>
        </span>
      )}
      {/*
        One row at every width. At the default button size these four overflow a
        390px viewport and wrap to a second line, so below `sm` they take the
        `compact` size's height and internal gap. The horizontal padding goes
        one step tighter than compact on purpose: at `px-3` the row still
        overflowed by 3px on a 390px screen, and the extra 16px reclaimed here
        is the headroom for a like count that grows past a single digit.
        `flex-nowrap` holds the line rather than silently wrapping again.
      */}
      <div className="flex flex-nowrap gap-2 max-sm:gap-1 max-sm:[&_button]:h-10 max-sm:[&_button]:gap-1 max-sm:[&_button]:px-2.5">
        <ShareDialog
          brandSlug={brandSlug}
          brandName={brandName}
          brandId={brandId}
          brandImageUrl={brandImageUrl}
          categoryLabel={categoryLabel}
        />
        {brandId && <LikeBrandButton brandId={brandId} slug={brandSlug} />}
        {brandId && <SaveBrandButton brandId={brandId} slug={brandSlug} variant="inline" className="rounded-xl" />}
        {/* Origin-evidence reporting is unwired for launch, not deleted: its only
            submit path required an account, and opening it to guests needs a
            migration (`origin_evidence.user_id` is NOT NULL) plus an anonymous
            upload path that `/api/upload` deliberately refuses today. Tracked on
            the public board as `origin_evidence_reports` (in_progress). Re-render
            `<EvidenceDialog brandId brandSlug />` here to restore it — the
            component, server action, service, and admin review queue all still
            work, so a dead-code pass must not remove them. */}
        {brandId && <ReportDialog brandId={brandId} brandSlug={brandSlug} />}
        {adminSlot}
      </div>
    </div>
  )
}
