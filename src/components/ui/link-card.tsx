import { cva } from 'class-variance-authority'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { surfaceCardStyles } from '@/components/ui/card'

/**
 * A card that is entirely one link: eyebrow, title, description, meta row.
 *
 * Extracted from the two byte-identical copies of this body that already exist
 * (`EventCard` and the related-stories list on the event detail page) so a
 * second, wider size can be added in one place. The prop names are deliberately
 * generic — `EventCard` maps onto them one-to-one (badge→eyebrow, name→title,
 * summary→description, date→meta) so that migration stays mechanical. Do not
 * add props that only one caller needs.
 */
type LinkCardProps = {
  href: string
  title: string
  eyebrow?: string | null
  description?: string | null
  /** Secondary fact rendered in the metadata style, e.g. a date. */
  meta?: string | null
  /** `narrow` for a rail or mobile column, `wide` for a half-width desktop band. */
  size?: 'narrow' | 'wide'
  /** `2` in an untitled grid, `3` under a section heading. */
  headingLevel?: 2 | 3
  /**
   * Escape hatch for the events surface, where an RSC navigation stalls across
   * the locale proxy rewrite (DEV-1280) and links must be full-document. Off by
   * default: internal links keep the client-side `Link`.
   */
  nativeLink?: boolean
}

/**
 * Only the size axis lives here. The surface itself — border, radius, hover
 * lift, focus ring — comes from `surfaceCardStyles`, so this card can never
 * drift from `BrandCard`/`EventCard`.
 *
 * The design calls for a 20/600 title at `wide`, which has no `type-*` utility:
 * the scale jumps from `type-card-title` (16/600) straight to
 * `type-section-title-large` (24/560). `type-card-title` is used at both sizes
 * rather than hand-picking a raw size — 24px would also outweigh the
 * `type-section-title` (16px) `<h2>` these cards sit under, inverting the page
 * hierarchy. The wider variant is expressed through padding, gap, and
 * description leading instead.
 */
const linkCardSizeStyles = cva('', {
  variants: {
    size: {
      narrow: 'space-y-2',
      wide: 'space-y-2.5',
    },
  },
  defaultVariants: { size: 'narrow' },
})

const linkCardDescriptionStyles = cva('line-clamp-2', {
  variants: {
    size: {
      narrow: 'type-card-description',
      wide: 'type-body-muted',
    },
  },
  defaultVariants: { size: 'narrow' },
})

export function LinkCard({
  href,
  title,
  eyebrow = null,
  description = null,
  meta = null,
  size = 'narrow',
  headingLevel = 3,
  nativeLink = false,
}: LinkCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const className = surfaceCardStyles({
    interactive: true,
    padding: size === 'wide' ? 'lg' : 'md',
    className: 'group block hover:bg-secondary',
  })

  const body = (
    <div className={linkCardSizeStyles({ size })}>
      {eyebrow ? <p className="type-eyebrow">{eyebrow}</p> : null}
      <Heading className="type-card-title group-hover:underline">{title}</Heading>
      {description ? (
        <p className={linkCardDescriptionStyles({ size })}>{description}</p>
      ) : null}
      {meta ? (
        <div className="flex items-center justify-between gap-2 type-metadata">
          <span>{meta}</span>
          {/* Affordance only: the whole card is the link, so an accessible name
              here would just repeat the destination. */}
          <ArrowRight
            aria-hidden="true"
            className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
          />
        </div>
      ) : null}
    </div>
  )

  if (nativeLink) {
    return (
      <a href={href} className={className}>
        {body}
      </a>
    )
  }

  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  )
}
