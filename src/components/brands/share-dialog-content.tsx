'use client'

import type { CSSProperties, ReactNode, SVGProps } from 'react'
import { useTranslations } from 'next-intl'
import { AtSign, Check, Link as LinkIcon, MessageCircle, X } from 'lucide-react'
import { SurfaceImage } from '@/components/ui/image'
import { trackBrandPageShared, type ShareChannel } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InstagramIcon } from '@/components/icons/instagram-icon'
import { ShareChannelButton } from './share-channel-button'
import { cn } from '@/lib/utils'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'

interface ShareDialogContentProps {
  brandSlug: string
  brandName: string
  brandImageUrl?: string
  brandId?: string
  categoryLabel?: string | null
  // Owned by the shell so the dialog's close handler can reset it without this
  // chunk being loaded.
  copiedKind: 'link' | 'instagram' | null
  flashCopied: (kind: 'link' | 'instagram', ms: number) => void
}

// Brand marks only — these hex values exist so each channel disc reads as the
// platform's own logo. Never reuse them for Formoria chrome; all Formoria
// interactive emphasis comes from the single accent (`bg-accent`).
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

export function ShareDialogContent({
  brandSlug,
  brandName,
  brandImageUrl,
  brandId,
  categoryLabel,
  copiedKind,
  flashCopied,
}: ShareDialogContentProps) {
  const t = useTranslations('brandDetail.share')
  const safeImage = safeImageSrc(brandImageUrl)
  // Read at render time rather than via an effect: this chunk is client-only
  // (`ssr: false`), so there is no server pass to mismatch against.
  const { origin, host } =
    typeof window === 'undefined' ? { origin: '', host: '' } : window.location
  const shareUrl = `${origin}/brands/${brandSlug}`
  const displayUrl = `${host}/brands/${brandSlug}`

  const copied = copiedKind === 'link'
  const instagramCopied = copiedKind === 'instagram'

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
      discClass: 'bg-ink text-ground',
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
    <DialogContent
      showCloseButton={false}
      className="w-[21rem] max-w-[calc(100%-2rem)] gap-0 rounded-surface p-0"
    >
      <div className="flex items-center justify-between border-b border-rule px-4 py-3">
        <DialogTitle>{t('dialogTitle')}</DialogTitle>
        <DialogClose
          render={
            <Button variant="ghost" size="icon" className="-mr-2" aria-label={t('close')} />
          }
          data-ph-no-autocapture
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
      </div>

      <div className="space-y-4 p-4">
        {/* Preview card — what the recipient will actually receive. */}
        <div className="overflow-hidden rounded-surface border border-rule bg-surface">
          {safeImage ? (
            <div className="relative h-[74px] w-full">
              <SurfaceImage
                src={safeImage}
                alt=""
                fill
                // Measured, with no surface to name: a fixed 74px-tall preview
                // strip, 256px wide on the narrow dialog and 336px otherwise.
                // Neither width is any of the layout slots.
                sizes="(max-width: 352px) 256px, 336px"
                className="object-cover"
              />
            </div>
          ) : (
            <div
              aria-hidden="true"
              className="flex h-[74px] w-full items-center justify-center bg-linear-to-br from-surface to-surface"
            >
              <span className="type-section text-ink-muted">
                {Array.from(brandName)[0] ?? ''}
              </span>
            </div>
          )}
          <div className="space-y-0.5 px-3 py-2.5">
            <p className="truncate type-body-sm font-medium text-ink">{brandName}</p>
            {/* text-foreground/70, not text-muted-foreground: muted-on-muted
                computes to 4.39:1 in the dark theme, below the 4.5:1 minimum. */}
            <p className="truncate type-metadata text-ink/70">
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
            className="h-10 rounded-control border-rule bg-surface pr-28 text-base text-ink/70 md:text-[13px]"
            data-ph-no-autocapture
          />
          <Button
            size="chip"
            className={cn(
              'absolute top-1 right-1',
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
          <span className="h-px flex-1 bg-rule" aria-hidden="true" />
          <span className="type-micro text-ink-muted">{t('orShareTo')}</span>
          <span className="h-px flex-1 bg-rule" aria-hidden="true" />
        </div>

        <div className="flex justify-between">
          {channels.map((channel) => (
            <ShareChannelButton
              key={channel.key}
              icon={channel.icon}
              label={channel.label}
              discClass={channel.discClass}
              discStyle={channel.discStyle}
              onClick={() => handleChannelClick(channel.key)}
            />
          ))}
        </div>

        {/* Rendered unconditionally so the live region exists in the a11y tree
            before the announcement; only its text content is conditional. */}
        <p
          role="status"
          className={cn(
            'rounded-surface bg-verified-green-bg px-3 py-2 type-micro text-verified-green transition-opacity duration-150',
            instagramCopied ? 'opacity-100' : 'sr-only opacity-0',
          )}
        >
          {instagramCopied ? t('instagramCopied') : ''}
        </p>
      </div>
    </DialogContent>
  )
}
