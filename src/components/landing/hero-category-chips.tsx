'use client'

import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { trackHeroCategoryClicked } from '@/lib/analytics'
import { cn } from '@/lib/utils'

interface HeroCategoryChipsProps {
  categories: Array<{ slug: string; label: string }>
}

export function HeroCategoryChips({ categories }: HeroCategoryChipsProps) {
  return (
    <>
      {categories.map((cat) => (
        <Link
          key={cat.slug}
          href={`/brands?category=${cat.slug}`}
          data-ph-no-autocapture
          onClick={() => trackHeroCategoryClicked(cat.slug, `/brands?category=${cat.slug}`)}
          // ui-exception: translucent hover border on hero, not in secondary variant; single site
          className={cn(
            buttonVariants({ variant: 'secondary', shape: 'pill', size: 'chip' }),
            'bg-background/80 text-muted-foreground hover:bg-background hover:border-foreground/30',
          )}
        >
          {cat.label}
        </Link>
      ))}
    </>
  )
}
