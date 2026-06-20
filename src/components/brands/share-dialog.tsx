'use client'

import { useEffect, useRef, useState, type SVGProps } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { useTranslations } from 'next-intl'
import {
  Check,
  Link,
  MessageCircle,
  Share2,
  X,
} from 'lucide-react'
import { trackBrandPageShared } from '@/lib/analytics'

interface ShareDialogProps {
  brandSlug: string
  brandName: string
  brandImageUrl?: string
}

function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M14 8h2V5h-2.5C10.5 5 9 6.8 9 9.4V11H7v3h2v5h3v-5h2.4l.6-3h-3V9.6c0-1 .4-1.6 2-1.6Z" />
    </svg>
  )
}

function TwitterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m5 5 14 14M19 5 5 19"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
    </svg>
  )
}

export function ShareDialog({ brandSlug, brandName, brandImageUrl }: ShareDialogProps) {
  const t = useTranslations('brandDetail.share')
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/brands/${brandSlug}`

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
    }
  }, [])

  const trackShare = () => {
    trackBrandPageShared(brandSlug)
  }

  const handleTriggerClick = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: brandName, url: shareUrl })
        trackShare()
        return
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
      }
    }

    setOpen(true)
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      trackShare()
      setCopied(true)

      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }

      copiedTimeoutRef.current = setTimeout(() => {
        setCopied(false)
        copiedTimeoutRef.current = null
      }, 2000)
    } catch {
      // Ignore copy failures so the UI only shows success after an actual copy.
    }
  }

  const handleLineShare = () => {
    trackShare()
    window.open(
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  const handleFacebookShare = () => {
    trackShare()
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  const handleXShare = () => {
    trackShare()
    window.open(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(brandName)}`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <button
        type="button"
        className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
        aria-label={t('trigger')}
        onClick={handleTriggerClick}
      >
        <Share2 size={16} />
        {t('trigger')}
      </button>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-80 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover p-0 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="font-heading text-base leading-none font-medium">
              {t('dialogTitle')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            {brandImageUrl && (
              <div
                aria-hidden="true"
                className="size-10 shrink-0 rounded-lg bg-cover bg-center"
                style={{ backgroundImage: `url(${brandImageUrl})` }}
              />
            )}
            <p className="min-w-0 truncate text-sm font-medium text-foreground">
              {brandName}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 p-4">
            <button
              type="button"
              className={`flex h-22 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl transition-colors ${
                copied ? 'bg-[#EAF3E8]' : 'bg-secondary hover:bg-secondary/80'
              }`}
              onClick={handleCopyLink}
            >
              {copied ? <Check className="size-5" /> : <Link className="size-5" />}
              <span className="text-sm font-medium">
                {copied ? t('copied') : t('copyLink')}
              </span>
            </button>

            <button
              type="button"
              className="flex h-22 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-secondary transition-colors hover:bg-secondary/80"
              onClick={handleLineShare}
            >
              <MessageCircle className="size-5 text-[#07B53B]" />
              <span className="text-sm font-medium">{t('line')}</span>
            </button>

            <button
              type="button"
              className="flex h-22 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-secondary transition-colors hover:bg-secondary/80"
              onClick={handleFacebookShare}
            >
              <FacebookIcon className="size-5 text-[#1877F2]" />
              <span className="text-sm font-medium">{t('facebook')}</span>
            </button>

            <button
              type="button"
              className="flex h-22 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-secondary transition-colors hover:bg-secondary/80"
              onClick={handleXShare}
            >
              <TwitterIcon className="size-5 text-foreground" />
              <span className="text-sm font-medium">{t('x')}</span>
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
