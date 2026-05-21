import Image from 'next/image'
import type { Brand } from '@/lib/types'

interface BrandFounderProps {
  brand: Brand
}

export function BrandFounder({ brand }: BrandFounderProps) {
  if (!brand.founder) return null

  const initials = brand.founder.name.charAt(0)

  return (
    <section className="border-t border-border pt-6">
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        Founder Story
      </h2>
      <div className="flex items-start gap-4">
        {/* Avatar */}
        {brand.founder.avatarUrl ? (
          <Image
            src={brand.founder.avatarUrl}
            alt={brand.founder.name}
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <span className="text-sm font-bold text-muted-foreground">
              {initials}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Name + title */}
          <p className="text-sm font-semibold text-foreground">
            {brand.founder.name}
            {brand.founder.title && <span className="font-normal text-warm-caption"> · {brand.founder.title}</span>}
          </p>

          {/* Quote */}
          {brand.founder.quote && (
            <blockquote className="mt-2 border-l-2 border-ring pl-4 text-sm italic leading-snug text-muted-foreground">
              {brand.founder.quote}
            </blockquote>
          )}
        </div>
      </div>
    </section>
  )
}
