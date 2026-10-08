'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Ellipsis, ExternalLink, Flag, Pencil } from 'lucide-react'
import { trackExternalLinkClicked } from '@/lib/analytics'
import type { BrandVisitLinkKind } from '@/lib/brands/link-fallback'
import {
  onlineStoreMessageKey,
  onlineStoreByKey,
  type OnlineStoreKey,
} from '@/lib/brands/online-stores'
import { CorrectionDialog } from '@/components/brands/correction-dialog'
import { ReportDialog } from '@/components/brands/report-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BrandRouteOutBar } from './brand-route-out-bar'
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

// Layout only (flex sizing and a width floor), shared by the live CTA and its
// disabled twin so both wrap the same way.
const VISIT_CTA_LAYOUT =
  'min-w-0 flex-1 basis-full min-[360px]:basis-auto md:flex-none md:min-w-60'

interface BrandActionsProps {
  adminSlot?: ReactNode
  websiteUrl: string | null
  visitKind?: BrandVisitLinkKind
  brandSlug?: string
  brandId?: string
  brandName: string
  brandImageUrl?: string
  categoryLabel?: string | null
  categorySlug?: string | null
  subcategories?: string[]
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
  categorySlug = null,
  subcategories = [],
}: BrandActionsProps) {
  const t = useTranslations('brandDetail')
  const visitLabel = t(VISIT_LABEL_KEYS[visitKind])
  // The mobile route-out bar watches this CTA and appears once it scrolls away.
  const visitCtaRef = useRef<HTMLAnchorElement>(null)
  // The two crowd-correction dialogs live outside the menu so they survive the
  // menu closing; a menu item only flips the dialog open.
  const [reportOpen, setReportOpen] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
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
    <>
      {/*
        The secondary actions are 44px icon buttons. Below 360px the visit CTA
        takes its own line and the icons wrap under it (BD2-01); up to md it
        takes the remaining space; from md it sizes to its label, at least
        240px, so the row reads as a button group (BD2-32). Height and padding
        come only from the Button `size` axis (DESIGN.md §7/§8) — the classes
        below are flex layout and a width floor, never a height or padding.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {websiteUrl ? (
          <a
            ref={visitCtaRef}
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'primary', className: VISIT_CTA_LAYOUT })}
            data-ph-no-autocapture
            onClick={handleWebsiteClick}
          >
            <ExternalLink className="size-[15px]" />
            <span className="truncate">{visitLabel}</span>
          </a>
        ) : (
          <span className={buttonVariants({ variant: 'secondary', className: `${VISIT_CTA_LAYOUT} cursor-default opacity-50` })} aria-disabled="true">
            <ExternalLink className="size-[15px]" />
            <span className="truncate line-through">{visitLabel}</span>
          </span>
        )}
        <ShareDialog
          brandSlug={brandSlug}
          brandName={brandName}
          brandId={brandId}
          brandImageUrl={brandImageUrl}
          categoryLabel={categoryLabel}
          iconOnly
        />
        {brandId && <SaveBrandButton brandId={brandId} slug={brandSlug} variant="inline" iconOnly />}
        {brandId && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('label.moreActions')}
              render={<Button variant="secondary" size="icon" />}
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            {/*
              `w-auto`: the popup defaults to the trigger's width (44px, floored
              at min-w-32), which wraps the EN labels onto two lines.
            */}
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem
                size="touch"
                onClick={() => setReportOpen(true)}
              >
                <Flag className="size-4" />
                {t('report.trigger')}
              </DropdownMenuItem>
              <DropdownMenuItem
                size="touch"
                onClick={() => setCorrectionOpen(true)}
              >
                <Pencil className="size-4" />
                {t('correction.trigger')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {adminSlot}
      </div>
      {brandId && (
        <>
          <ReportDialog
            brandId={brandId}
            brandSlug={brandSlug}
            open={reportOpen}
            onOpenChange={setReportOpen}
          />
          <CorrectionDialog
            brandId={brandId}
            brandSlug={brandSlug}
            mode="brandInfo"
            categorySlug={categorySlug}
            subcategories={subcategories}
            open={correctionOpen}
            onOpenChange={setCorrectionOpen}
          />
        </>
      )}
      {websiteUrl && (
        <BrandRouteOutBar
          ctaRef={visitCtaRef}
          href={websiteUrl}
          label={visitLabel}
          brandName={brandName}
          brandId={brandId}
          brandSlug={brandSlug}
          onVisitClick={handleWebsiteClick}
        />
      )}
    </>
  )
}
