import Link from 'next/link'
import Image from 'next/image'
import type { Brand } from '@/lib/types'

interface BrandCardProps {
  brand: Brand
}

export function BrandCard({ brand }: BrandCardProps) {
  return (
    <Link
      href={`/brands/${brand.slug}`}
      className="group block rounded-xl border border-border bg-card transition-all hover:-translate-y-px hover:shadow-[0_2px_8px_oklch(0_0_0_/_0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={brand.name}
    >
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-muted">
        {brand.heroImageUrl || brand.logoUrl ? (
          <Image
            src={(brand.heroImageUrl ?? brand.logoUrl) as string}
            alt={brand.name}
            fill
            className="object-cover transition-transform group-hover:scale-[1.02]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-2xl font-bold text-muted-foreground">
              {brand.name.charAt(0)}
            </span>
          </div>
        )}
        {/* Category overlay pill */}
        {brand.category && (
          <span className="absolute left-3 top-3 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground">
            {brand.category}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="text-sm font-bold leading-snug text-foreground">{brand.name}</h3>
        {brand.description && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
            {brand.description}
          </p>
        )}
        {brand.foundingYear && (
          <p className="mt-2 text-xs text-muted-foreground">Est. {brand.foundingYear}</p>
        )}
        {brand.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {brand.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="inline-block rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-secondary-foreground"
              >
                {tag.nameZh ?? tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
