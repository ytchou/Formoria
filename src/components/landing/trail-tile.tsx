'use client'

import { SurfaceImage } from '@/components/ui/image'

import { Link } from '@/i18n/navigation'
import { trackTrailCardClicked } from '@/lib/analytics'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import type { TrailEntry } from '@/lib/services/trails'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

export type TrailTileLabels = {
  eyebrow: string
  cta: string
}

/**
 * The 3:2 ratio follows the photograph while the height floor protects the
 * copy stack. A single-column band also has a ceiling so it cannot grow taller
 * than the viewport-scale section it belongs to.
 */
export function TrailTile({
  trail,
  labels,
  position,
  singleColumn = false,
  className,
}: {
  trail: TrailEntry
  labels: TrailTileLabels
  position: number
  singleColumn?: boolean
  className?: string
}) {
  const title = trail.frontmatter.title
  const promise = trail.frontmatter.promise ?? trail.frontmatter.description ?? ''
  /*
   * `safeImageSrc` now owns the same-origin case itself (DEV-1551), so a hero
   * committed at `/images/trails/x.webp` survives without a caller-side
   * leading-slash branch — and a protocol-relative `//host/x.png`, which such a
   * branch waved through, does not.
   *
   * The imageless branch below stays: it is the degradation path for a 404 or a
   * disallowed host, not a supply gate.
   */
  const imageSrc = safeImageSrc(trail.frontmatter.heroImage)
  /*
   * Empty, never the title. The link is already `aria-labelledby` the title
   * beside it, so repeating the title as image text announces the same words
   * twice.
   */
  const imageAlt = trail.frontmatter.heroImageAlt ?? ''
  const titleId = `trail-${trail.slug}-title`

  return (
    <li
      className={cn(
        'relative aspect-[3/2] min-h-80 list-none overflow-hidden rounded-surface bg-ink text-ground',
        singleColumn && 'max-h-[35rem]',
        className,
      )}
    >
      <Link
        href={routes.trail(trail.slug)}
        prefetch={false}
        aria-labelledby={titleId}
        data-ph-no-autocapture
        onClick={() => trackTrailCardClicked(trail.slug, position, 'homepage_trails')}
        className="group relative flex h-full min-h-80 flex-col justify-end overflow-hidden p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3 md:p-8"
      >
        {imageSrc ? (
          <SurfaceImage
            src={imageSrc}
            alt={imageAlt}
            fill
            sizes={singleColumn ? '100vw' : '(max-width: 1024px) 100vw, 33vw'}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
          />
        ) : null}
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/55 to-ink/10"
        />
        <span className="relative z-10 flex max-w-xl flex-col items-start gap-3">
          <span className="rounded-full border border-ground/30 bg-ground/20 px-3 py-1 type-eyebrow text-ground">
            {labels.eyebrow}
          </span>
          <h3 id={titleId} className="type-card-title text-ground md:type-section">
            {title}
          </h3>
          {promise ? <span className="type-body text-on-ink line-clamp-3">{promise}</span> : null}
          <span className="inline-flex min-h-12 items-center font-medium text-ground underline underline-offset-4 transition-colors group-hover:text-ground/80">
            {labels.cta}
          </span>
        </span>
      </Link>
    </li>
  )
}
