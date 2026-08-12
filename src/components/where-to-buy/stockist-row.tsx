import { ExternalLink, MapPin } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { StockistLocation } from '@/lib/services/brand-channels'

export function StockistRow({ location, mapsLabel }: { location: StockistLocation; mapsLabel: string }) {
  const mapsHref = location.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`
    : null
  return (
    <li className="border-t border-border py-4 first:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="type-body-emphasis text-foreground">{location.name}</p>
          <Link href={`/brands/${location.brandSlug}`} className="mt-1 inline-flex min-h-8 items-center type-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary">
            {location.brandName}
          </Link>
          {location.address ? (
            <p className="mt-1 flex gap-2 type-caption text-muted-foreground">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{location.address}</span>
            </p>
          ) : null}
        </div>
        {mapsHref ? (
          <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1 type-body-emphasis text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary">
            {mapsLabel}<ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>
    </li>
  )
}
