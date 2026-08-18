'use client'

import Image from 'next/image'
import type { CSSProperties } from 'react'

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
 * Trail tiles are sized editorially rather than measured, so their two formats
 * are declared here as RATIOS — the same currency the justified-row layout uses
 * for a product tile's measured shape (see `product-wall.tsx`).
 *
 * They were column spans under the old masonry: `tall` a 95-unit row span,
 * `wide` a full-width band. A band cannot survive a justified line, because a
 * line's tiles must share a height; a wide trail is now simply the widest tile
 * ON its line, at 3:2 against a portrait 3:4 for `tall`. The alternation still
 * reads as two different modules, which is all the format ever promised.
 *
 * The floor matters: eyebrow, title, a three-line promise and a 48px CTA need
 * ~285px inside `md:p-8`. The link is `justify-end` under `overflow-hidden`, so
 * a shortfall clips the title off the TOP rather than overflowing visibly —
 * hence `min-h-80` staying on both the tile and the link at every breakpoint.
 */
const TRAIL_FORMAT_RATIO: Record<WallTrailFormat, number> = {
  tall: 3 / 4,
  wide: 3 / 2,
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
      style={{ '--tile-ratio': TRAIL_FORMAT_RATIO[format] } as CSSProperties}
      className={cn(
        // `rounded-lg` is DESIGN.md's container radius; this tile is a
        // top-level surface, not a nested one.
        'relative list-none min-h-80 overflow-hidden rounded-lg bg-foreground text-background sm:min-h-0',
        // Same flex arithmetic as a product tile — one per line on phones, then
        // basis and grow both proportional to the format's ratio.
        'basis-full grow-0',
        'sm:basis-[calc(var(--wall-line-h)*var(--tile-ratio))] sm:grow-[var(--tile-ratio)]',
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
            // Both formats are ordinary tiles on a justified line now, not a
            // full-width band, so neither asks for a viewport-wide candidate on
            // desktop. `wide` is 3:2 against `tall`'s 3:4 — twice the width for
            // the same line height, hence 30vw against 20vw.
            sizes={
              format === 'wide'
                ? '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 30vw'
                : '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 20vw'
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
