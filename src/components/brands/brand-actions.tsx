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
  line: 'actions.visitLine',
} satisfies Record<BrandVisitLinkKind, string>

// Layout only (a width cap), shared by the live CTA and its disabled twin so
// both size the same way.
const VISIT_CTA_LAYOUT = 'w-full min-w-0 md:max-w-80'

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
  // The link type is the channel the CTA routes to (BD-03): a Shopee or Pinkoi
  // route-out logged as `website` hid which channel readers actually took.
  const handleVisitClick = () => {
    trackExternalLinkClicked(
      brandSlug,
      visitKind,
      typeof window !== 'undefined' ? window.location.pathname : '',
      'detail_page',
      brandId,
    )
  }

  return (
    <>
      {/*
        The visit CTA has a row of its own at every width, capped at 320px
        from md so it reads as a button rather than a bar (BD2-32); Share and
        Save sit under it as labelled buttons, with the overflow menu the one
        icon-only control (BD-14). Height and padding come only from the
        Button `size` axis (DESIGN.md §7/§8) — the classes below are flex
        layout and a width cap, never a height or padding.
      */}
      <div className="flex flex-col items-start gap-2">
        {websiteUrl ? (
          <a
            ref={visitCtaRef}
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'primary', className: VISIT_CTA_LAYOUT })}
            data-ph-no-autocapture
            onClick={handleVisitClick}
          >
            <ExternalLink className="size-[15px]" aria-hidden />
            <span className="truncate">{visitLabel}</span>
          </a>
        ) : (
          // Muted and non-interactive, never struck through: the label names
          // a route the brand has not given us, not a withdrawn one (BD-COPY-07).
          <span className={buttonVariants({ variant: 'secondary', className: `${VISIT_CTA_LAYOUT} cursor-default opacity-50` })} aria-disabled="true">
            <ExternalLink className="size-[15px]" aria-hidden />
            <span className="truncate">{visitLabel}</span>
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ShareDialog
            brandSlug={brandSlug}
            brandName={brandName}
            brandId={brandId}
            brandImageUrl={brandImageUrl}
            categoryLabel={categoryLabel}
          />
          {brandId && <SaveBrandButton brandId={brandId} slug={brandSlug} variant="inline" />}
          {brandId && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('label.moreActions')}
                render={<Button variant="secondary" size="icon" />}
              >
                <Ellipsis className="size-4" aria-hidden />
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
          onVisitClick={handleVisitClick}
        />
      )}
    </>
  )
}
