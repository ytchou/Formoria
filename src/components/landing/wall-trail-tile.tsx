'use client'

import Image from 'next/image'

import { Link } from '@/i18n/navigation'
import type { WallTrailFormat } from '@/lib/curated-products/home-wall'
import { trackTrailCardClicked } from '@/lib/analytics'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import type { TrailEntry } from '@/lib/services/trails'
import { cn } from '@/lib/utils'

export type WallTrailTileLabels = {
  eyebrow: string
  cta: string
}

/**
 * Trail tiles are sized editorially rather than measured, so their spans are
 * declared here in the same column-relative unit the product tiles use. Literal
 * classes because Tailwind scans source text, never runtime strings.
 *
 * The wide format spans EVERY column at every multi-column breakpoint — two at
 * `sm`, four at `lg` — rather than two of four. Sparse auto-placement (the only
 * mode allowed here, because `grid-auto-flow: dense` would divorce visual order
 * from DOM order) can only place a multi-column tile where its tracks are all
 * free at once, so a 2-of-4 tile parked the cursor mid-grid and left cells no
 * later single-column tile could ever fill. Spanning the full width instead
 * makes the tile a band: it lands after the longest track, and every track
 * restarts in phase beneath it. The ragged edge above the band is the ordinary
 * masonry edge, not a hole.
 *
 * Its row span carries the tile's own content: eyebrow, title, a three-line
 * promise and a 48px CTA need ~285px inside `md:p-8`, which 65 units did not
 * give at `lg` — the link is `justify-end` under `overflow-hidden`, so the
 * shortfall clipped the title off the TOP rather than overflowing visibly.
 */
const TRAIL_FORMAT_CLASS: Record<WallTrailFormat, string> = {
  tall: 'sm:[grid-row:span_95/span_95]',
  wide: 'sm:col-span-2 sm:[grid-row:span_75/span_75] lg:col-span-4',
}

export function WallTrailTile({
  trail,
  labels,
  format,
  position,
  className,
}: {
  trail: TrailEntry
  labels: WallTrailTileLabels
  format: WallTrailFormat
  position: number
  className?: string
}) {
  const title = trail.frontmatter.title
  const promise = trail.frontmatter.promise ?? trail.frontmatter.description ?? ''
  const imageSrc = safeImageSrc(trail.frontmatter.heroImage)
  const imageAlt = trail.frontmatter.heroImageAlt ?? title
  const titleId = `wall-trail-${trail.slug}-title`

  return (
    <li
      className={cn(
        // `rounded-lg` is DESIGN.md's container radius; this tile is a
        // top-level surface, not a nested one.
        'relative list-none min-h-80 overflow-hidden rounded-lg bg-foreground text-background sm:min-h-0',
        TRAIL_FORMAT_CLASS[format],
        className,
      )}
    >
      <Link
        href={`/discover/${trail.slug}`}
        prefetch={false}
        aria-labelledby={titleId}
        data-ph-no-autocapture
        onClick={() => trackTrailCardClicked(trail.slug, position, 'homepage_wall')}
        className="group relative flex h-full min-h-80 flex-col justify-end overflow-hidden p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3 sm:min-h-0 md:p-8"
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={imageAlt}
            fill
            // The wide format is full-bleed within the content measure at every
            // breakpoint, and that measure caps at 1000px (72rem less the 5rem
            // gutter). `50vw` here made the tablet tile upscale a ~480w
            // candidate by nearly 2x.
            sizes={
              format === 'wide'
                ? '(max-width: 1024px) 100vw, 1000px'
                : '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw'
            }
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
          />
        ) : null}
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-foreground/95 via-foreground/55 to-foreground/10"
        />
        <span className="relative z-10 flex max-w-xl flex-col items-start gap-3">
          <span className="rounded-full border border-background/30 bg-background/20 px-3 py-1 type-eyebrow text-background">
            {labels.eyebrow}
          </span>
          <span id={titleId} className="type-card-title md:type-display text-background">
            {title}
          </span>
          {promise ? <span className="type-body-inverse line-clamp-3">{promise}</span> : null}
          <span className="inline-flex min-h-12 items-center font-medium text-background underline underline-offset-4 transition-colors group-hover:text-background/80">
            {labels.cta}
          </span>
        </span>
      </Link>
    </li>
  )
}
