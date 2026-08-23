'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { Share2 } from 'lucide-react'
import { trackBrandPageShared } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { DialogLoadingContent } from '@/components/brands/dialog-loading-content'

// Click-gated: the preview card, channel discs and copy affordances only reach
// the browser once the trigger is primed. `ssr: false` because the body only
// ever renders inside an open dialog portal. `loading` keeps the overlay and
// focus trap mounted while the chunk is in flight, matching the body's width.
const ShareDialogContent = dynamic(
  () => import('@/components/brands/share-dialog-content').then((m) => m.ShareDialogContent),
  {
    ssr: false,
    loading: () => (
      <DialogLoadingContent className="w-[21rem] max-w-[calc(100%-2rem)] rounded-surface sm:max-w-[21rem]" />
    ),
  },
)

interface ShareDialogProps {
  brandSlug: string
  brandName: string
  brandImageUrl?: string
  brandId?: string
  categoryLabel?: string | null
}

export function ShareDialog({
  brandSlug,
  brandName,
  brandImageUrl,
  brandId,
  categoryLabel,
}: ShareDialogProps) {
  const t = useTranslations('brandDetail.share')
  const [open, setOpen] = useState(false)
  // Once primed the content stays mounted, so its state survives close/reopen
  // exactly as it did when the body was statically imported.
  const [primed, setPrimed] = useState(false)
  // One success signal for both affordances: the copy chip and the Instagram
  // status strip can never light at the same time, and it is reset on close so
  // reopening inside the flash window never shows a stale banner. It lives in
  // the shell because the close handler owns the reset.
  const [copiedKind, setCopiedKind] = useState<'link' | 'instagram' | null>(null)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const prime = () => setPrimed(true)

  // Only genuine touch devices get the OS share sheet; desktop Chrome/Edge
  // also expose navigator.share and would otherwise never see this dialog.
  const isCoarsePointer = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches === true

  // Hover/press/focus priming is a desktop-only preload. On coarse pointers the
  // same gestures precede a tap that usually ends in the OS share sheet, where
  // the dialog body chunk is pure waste — which is the traffic majority.
  const primeOnDesktopPointer = () => {
    if (!isCoarsePointer()) prime()
  }

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
    }
  }, [])

  // Reset on close in the change handler rather than an `open`-keyed effect:
  // the React Compiler lint rejects synchronous setState inside an effect.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
        copiedTimeoutRef.current = null
      }
      setCopiedKind(null)
    }
    setOpen(next)
  }

  const flashCopied = (kind: 'link' | 'instagram', ms: number) => {
    setCopiedKind(kind)

    if (copiedTimeoutRef.current) {
      clearTimeout(copiedTimeoutRef.current)
    }

    copiedTimeoutRef.current = setTimeout(() => {
      setCopiedKind(null)
      copiedTimeoutRef.current = null
    }, ms)
  }

  const handleTriggerClick = async () => {
    const isTouchDevice = isCoarsePointer()

    const shareUrl =
      typeof window === 'undefined' ? '' : `${window.location.origin}/brands/${brandSlug}`

    if (isTouchDevice && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: brandName, url: shareUrl })
        trackBrandPageShared(brandSlug, brandId, 'native')
        return
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
      }
    }

    // Primed only once the in-app dialog is certain to be shown: a native share
    // sheet (or its dismissal) returns above without ever mounting the body.
    prime()
    setOpen(true)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="secondary"
        className="shrink-0"
        onClick={handleTriggerClick}
        onPointerEnter={primeOnDesktopPointer}
        onPointerDown={primeOnDesktopPointer}
        onFocus={primeOnDesktopPointer}
        data-ph-no-autocapture
      >
        <Share2 className="size-4" aria-hidden="true" />
        {t('trigger')}
      </Button>
      {primed && (
        <ShareDialogContent
          brandSlug={brandSlug}
          brandName={brandName}
          brandImageUrl={brandImageUrl}
          brandId={brandId}
          categoryLabel={categoryLabel}
          copiedKind={copiedKind}
          flashCopied={flashCopied}
        />
      )}
    </Dialog>
  )
}
