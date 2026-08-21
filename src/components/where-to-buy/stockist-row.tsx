import { ExternalLink, MapPin } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { StockistLocation } from '@/lib/services/stockists'
import { routes } from '@/lib/routes'

export function StockistRow({
  location,
  mapsLabel,
}: {
  location: StockistLocation
  mapsLabel: string
}) {
  const mapsHref = location.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`
    : null
  return (
    <li className="border-t border-rule py-4 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="type-body-sm font-medium text-ink">{location.name}</p>
          <Link
            href={routes.brand(location.brandSlug)}
            className="mt-1 inline-flex min-h-8 items-center type-metadata text-ink-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent"
          >
            {location.brandName}
          </Link>
          {location.address ? (
            <p className="mt-1 flex gap-2 type-metadata text-ink-muted">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{location.address}</span>
            </p>
          ) : null}
        </div>
        {mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 type-body-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent"
          >
            {mapsLabel}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>
    </li>
  )
}
