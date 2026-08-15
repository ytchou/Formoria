'use client'

import Image from 'next/image'

import { Link } from '@/i18n/navigation'
import { trackTrailCardClicked } from '@/lib/analytics'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import type { TrailEntry } from '@/lib/services/trails'

export type WallTrailTileLabels = {
  eyebrow: string
  cta: string
}

export function WallTrailTile({
  trail,
  labels,
  position,
}: {
  trail: TrailEntry
  labels: WallTrailTileLabels
  position: number
}) {
  const title = trail.frontmatter.title
  const promise = trail.frontmatter.promise ?? trail.frontmatter.description ?? ''
  const imageSrc = safeImageSrc(trail.frontmatter.heroImage)
  const imageAlt = trail.frontmatter.heroImageAlt ?? title
  const titleId = `wall-trail-${trail.slug}-title`

  return (
    <li className="relative col-span-2 row-span-2 min-h-80 overflow-hidden rounded-xl bg-foreground text-background">
      <Link
        href={`/discover/${trail.slug}`}
        prefetch={false}
        aria-labelledby={titleId}
        data-ph-no-autocapture
        onClick={() => trackTrailCardClicked(trail.slug, position, 'homepage_wall')}
        className="group relative flex h-full min-h-80 flex-col justify-end overflow-hidden p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3 md:p-8"
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={imageAlt}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
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
