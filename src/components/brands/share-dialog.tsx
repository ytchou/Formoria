'use client'

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
} from 'react'
import { useTranslations } from 'next-intl'
import { AtSign, Check, Link as LinkIcon, MessageCircle, Share2, X } from 'lucide-react'
import Image from 'next/image'
import { trackBrandPageShared, type ShareChannel } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InstagramIcon } from '@/components/icons/instagram-icon'
import { cn } from '@/lib/utils'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'

interface ShareDialogProps {
  brandSlug: string
  brandName: string
  brandImageUrl?: string
  brandId?: string
  categoryLabel?: string | null
}

// Brand marks only — these hex values exist so each channel disc reads as the
// platform's own logo. Never reuse them for Formoria chrome; all Formoria
// interactive emphasis comes from the single kiln accent (`bg-primary`).
const LINE_DISC = 'bg-[#06C755]'
const FACEBOOK_DISC = 'bg-[#1877F2]'
const INSTAGRAM_DISC_STYLE: CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at 30% 107%, #FDF497 0%, #FD5949 45%, #D6249F 60%, #285AEB 90%)',
}

const COPIED_RESET_MS = 2000
const INSTAGRAM_STATUS_MS = 4000

function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M14 8h2V5h-2.5C10.5 5 9 6.8 9 9.4V11H7v3h2v5h3v-5h2.4l.6-3h-3V9.6c0-1 .4-1.6 2-1.6Z" />
    </svg>
  )
}

// Only the channels this dialog actually renders. Narrower than `ShareChannel`
// (which also carries 'native' and 'copy_link') so the dispatcher's `never`
// default forces every array entry to have a matching handler.
type ChannelKey = Extract<ShareChannel, 'line' | 'threads' | 'facebook' | 'instagram'>

type Channel = {
  key: ChannelKey
  label: string
  discClass: string
  discStyle?: CSSProperties
  icon: ReactNode
}

export function ShareDialog({
  brandSlug,
  brandName,
  brandImageUrl,
  brandId,
  categoryLabel,
}: ShareDialogProps) {
  const t = useTranslations('brandDetail.share')
  const safeImage = safeImageSrc(brandImageUrl)
  const [open, setOpen] = useState(false)
  // One success signal for both affordances: the copy chip and the Instagram
  // status strip can never light at the same time, and it is reset on close so
  // reopening inside the flash window never shows a stale banner.
  const [copiedKind, setCopiedKind] = useState<'link' | 'instagram' | null>(null)
  // Read at render time rather than via an effect: the popup (the only consumer
  // of `origin`) is unmounted while the dialog is closed, so there is nothing
  // for the server pass to mismatch against.
  const { origin, host } =
    typeof window === 'undefined' ? { origin: '', host: '' } : window.location
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shareUrl = `${origin}/brands/${brandSlug}`
  const displayUrl = `${host}/brands/${brandSlug}`

  const copied = copiedKind === 'link'
  const instagramCopied = copiedKind === 'instagram'

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
    // Only genuine touch devices get the OS share sheet; desktop Chrome/Edge
    // also expose navigator.share and would otherwise never see this dialog.
    const isTouchDevice =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: coarse)')?.matches === true

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

    setOpen(true)
  }

  const openShareWindow = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      trackBrandPageShared(brandSlug, brandId, 'copy_link')
      flashCopied('link', COPIED_RESET_MS)
    } catch {
      // Ignore copy failures so the UI only shows success after an actual copy.
    }
  }

  const handleLineShare = () => {
    trackBrandPageShared(brandSlug, brandId, 'line')
    openShareWindow(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`)
  }

  const handleThreadsShare = () => {
    trackBrandPageShared(brandSlug, brandId, 'threads')
    openShareWindow(`https://www.threads.net/intent/post?text=${encodeURIComponent(`${brandName} ${shareUrl}`)}`)
  }

  const handleFacebookShare = () => {
    trackBrandPageShared(brandSlug, brandId, 'facebook')
    openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`)
  }

  // Instagram has no web share intent, so the link is copied first and the app
  // is only opened once that copy has actually succeeded.
  const handleInstagramShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch {
      return
    }

    trackBrandPageShared(brandSlug, brandId, 'instagram')
    // Ceiling: awaiting the clipboard write can consume transient user
    // activation on Safari/Firefox, so this popup may be blocked there.
    // Accepted — the role="status" strip already tells the user the link is
    // copied and to paste it.
    openShareWindow('https://www.instagram.com/')
    flashCopied('instagram', INSTAGRAM_STATUS_MS)
  }

  // Single dispatcher instead of an `onClick` per array entry: the React
  // Compiler lint (react-hooks/refs) rejects mapping over a render-time array
  // that carries closures which touch timeout refs.
  const handleChannelClick = (key: ChannelKey) => {
    switch (key) {
      case 'line':
        return handleLineShare()
      case 'threads':
        return handleThreadsShare()
      case 'facebook':
        return handleFacebookShare()
      case 'instagram':
        return void handleInstagramShare()
      default: {
        const exhaustive: never = key
        return exhaustive
      }
    }
  }

  const channels: Channel[] = [
    {
      key: 'line',
      label: t('line'),
      // Fixed brand backgrounds need the canonical white glyph; `text-background`
      // would flip to near-black in the dark theme. Only Threads (bg-foreground)
      // is genuinely theme-paired.
      discClass: `${LINE_DISC} text-white`,
      icon: <MessageCircle className="size-5" aria-hidden="true" />,
    },
    {
      key: 'threads',
      label: t('threads'),
      discClass: 'bg-foreground text-background',
      icon: <AtSign className="size-5" aria-hidden="true" />,
    },
    {
      key: 'facebook',
      label: t('facebook'),
      discClass: `${FACEBOOK_DISC} text-white`,
      icon: <FacebookIcon className="size-5" />,
    },
    {
      key: 'instagram',
      label: t('instagram'),
      discClass: 'text-white',
      discStyle: INSTAGRAM_DISC_STYLE,
      icon: <InstagramIcon className="size-5" />,
    },
  ]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="secondary"
        className="shrink-0"
        onClick={handleTriggerClick}
        data-ph-no-autocapture
      >
        <Share2 className="size-4" aria-hidden="true" />
        {t('trigger')}
      </Button>
      <DialogContent
        showCloseButton={false}
        className="w-[21rem] max-w-[calc(100%-2rem)] gap-0 rounded-2xl p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogClose
            render={
              <Button variant="ghost" size="icon" className="-mr-2 size-11" aria-label={t('close')} />
            }
            data-ph-no-autocapture
          >
            <X className="size-4" aria-hidden="true" />
          </DialogClose>
        </div>

        <div className="space-y-4 p-4">
          {/* Preview card — what the recipient will actually receive. */}
          <div className="overflow-hidden rounded-xl border border-border bg-muted">
            {safeImage ? (
              <div className="relative h-[74px] w-full">
                <Image
                  src={safeImage}
                  alt=""
                  fill
                  sizes="(max-width: 352px) 256px, 336px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div
                aria-hidden="true"
                className="flex h-[74px] w-full items-center justify-center bg-linear-to-br from-secondary to-muted"
              >
                <span className="type-page-title text-muted-foreground">
                  {Array.from(brandName)[0] ?? ''}
                </span>
              </div>
            )}
            <div className="space-y-0.5 px-3 py-2.5">
              <p className="truncate type-body-emphasis">{brandName}</p>
              {/* text-foreground/70, not text-muted-foreground: muted-on-muted
                  computes to 4.39:1 in the dark theme, below the 4.5:1 minimum. */}
              <p className="truncate type-caption text-foreground/70">
                {host}
                {categoryLabel ? ` · ${categoryLabel}` : ''}
              </p>
            </div>
          </div>

          {/* URL field — the exact link is visible before anything is pressed. */}
          <div className="relative">
            <Input
              readOnly
              value={displayUrl}
              aria-label={t('urlLabel')}
              onFocus={(event) => event.currentTarget.select()}
              // text-base on mobile keeps the 16px floor that stops iOS Safari
              // auto-zooming on focus (this field calls select() on focus);
              // text-foreground/70 clears 4.5:1 on the muted surface in dark mode.
              className="h-10 rounded-lg border-border bg-muted pr-28 font-mono text-base text-foreground/70 md:text-[13px]"
              data-ph-no-autocapture
            />
            <Button
              size="chip"
              className={cn(
                'absolute top-1 right-1 h-8 rounded-lg',
                copied && 'bg-verified-green-bg text-verified-green hover:bg-verified-green-bg',
              )}
              onClick={handleCopyLink}
              data-ph-no-autocapture
            >
              {copied ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <LinkIcon className="size-3.5" aria-hidden="true" />
              )}
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>

          {/* Hand-rolled rather than ui/separator: that primitive has no
              children/label slot, so a centred label would need two Separators
              and would announce two role="separator" nodes. These spans are
              aria-hidden. */}
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="type-micro text-muted-foreground">{t('orShareTo')}</span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>

          <div className="flex justify-between">
            {channels.map((channel) => (
              <button
                key={channel.key}
                type="button"
                onClick={() => handleChannelClick(channel.key)}
                data-ph-no-autocapture
                // w-15 (60px), not w-16: four 64px buttons exactly fill the
                // 256px content width at a 288px dialog, so the hit rectangles
                // would abut with no gutter. The 44px disc is unchanged.
                // eslint-disable-next-line no-restricted-syntax -- ui-exception: 44px brand disc with label beneath, not a Button shape
                className="flex w-15 cursor-pointer flex-col items-center gap-1.5 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  style={channel.discStyle}
                  className={cn(
                    // Tailwind's `hover:` variant is already wrapped in @media (hover: hover).
                    'flex size-11 items-center justify-center rounded-full transition-transform duration-150 hover:scale-105',
                    channel.discClass,
                  )}
                >
                  {channel.icon}
                </span>
                <span className="type-micro text-muted-foreground">{channel.label}</span>
              </button>
            ))}
          </div>

          {/* Rendered unconditionally so the live region exists in the a11y tree
              before the announcement; only its text content is conditional. */}
          <p
            role="status"
            className={cn(
              'rounded-lg bg-verified-green-bg px-3 py-2 type-micro text-verified-green transition-opacity duration-150',
              instagramCopied ? 'opacity-100' : 'sr-only opacity-0',
            )}
          >
            {instagramCopied ? t('instagramCopied') : ''}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
