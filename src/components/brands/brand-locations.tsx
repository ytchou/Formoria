import { MapPin } from 'lucide-react'
import type { Brand } from '@/lib/types'

interface BrandLocationsProps {
  brand: Brand
}

export function BrandLocations({ brand }: BrandLocationsProps) {
  if (brand.retailLocations.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 font-[family-name:var(--font-heading)] text-lg font-bold text-foreground">
        Locations
      </h2>
      <div className="space-y-6">
        {brand.retailLocations.slice(0, 3).map((location, i) => (
          <div key={i}>
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">{location.name}</p>
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(location.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {location.address}
                </a>
              </div>
            </div>
            <iframe
              src={`https://maps.google.com/maps?q=${encodeURIComponent(location.address)}&output=embed`}
              loading="lazy"
              className="mt-3 h-44 w-full rounded-xl border-0"
              title={`${location.name} map`}
              allowFullScreen={false}
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ))}
      </div>
    </section>
  )
}
