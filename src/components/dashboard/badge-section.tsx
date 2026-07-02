'use client'

import { useState } from 'react'
import { buildBadgeEmbedSnippet, buildShareCardUrl } from '@/lib/growth/share-assets'
import { trackListingSharedByOwner } from '@/lib/analytics'

type BadgeSectionLabels = {
  copy?: string
  copied?: string
  download?: string
}

type BadgeSectionProps = {
  brandSlug: string
  brandUpdatedAt: string
  siteUrl: string
  labels?: BadgeSectionLabels
}

export function BadgeSection({ brandSlug, brandUpdatedAt, siteUrl, labels }: BadgeSectionProps) {
  const [copied, setCopied] = useState(false)
  const [showFallback, setShowFallback] = useState(false)

  const snippet = buildBadgeEmbedSnippet(siteUrl, brandSlug)
  const cardUrl = buildShareCardUrl(siteUrl, brandSlug)
  const cardPreviewSrc = `${cardUrl}?v=${encodeURIComponent(brandUpdatedAt)}`
  const cardDownloadHref = buildShareCardUrl(siteUrl, brandSlug, { download: true })

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      trackListingSharedByOwner(brandSlug, 'badge_copied')
    } catch {
      setShowFallback(true)
    }
  }

  function handleDownload() {
    trackListingSharedByOwner(brandSlug, 'card_downloaded')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/badges/featured-on-formoria.svg"
          alt="Featured on Formoria"
          width={200}
          height={56}
          className="shrink-0"
        />
      </div>

      <div className="space-y-3">
        <pre className="overflow-x-auto rounded-xl border border-border bg-muted p-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
          {snippet}
        </pre>

        {showFallback ? (
          <textarea
            readOnly
            className="w-full rounded-xl border border-border bg-muted p-3 text-xs font-mono text-muted-foreground"
            value={snippet}
            rows={4}
            aria-label="Embed code"
          />
        ) : null}

        <button
          data-testid="badge-copy-button"
          onClick={handleCopy}
          type="button"
          className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {copied ? (labels?.copied ?? 'Copied!') : (labels?.copy ?? 'Copy embed code')}
        </button>
      </div>

      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          data-testid="share-card-preview"
          src={cardPreviewSrc}
          alt="Share card preview"
          className="w-full max-w-sm rounded-xl border border-border"
        />

        <a
          data-testid="card-download-link"
          href={cardDownloadHref}
          download
          onClick={handleDownload}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {labels?.download ?? 'Download share card'}
        </a>
      </div>
    </div>
  )
}
