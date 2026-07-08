import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Heart } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { getUserSavedBrands } from '@/lib/services/saved-brands'
import { createClient } from '@/lib/supabase/server'
import type { SavedBrand } from '@/lib/types/saved-brand'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  params: Promise<{ locale: string }>
}

function BrandImage({ brand }: { brand: SavedBrand }) {
  if (!brand.heroImageUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-secondary">
        <span className="text-3xl font-bold text-muted-foreground">
          {[...brand.brandName][0]}
        </span>
      </div>
    )
  }

  return (
    <Image
      alt={brand.brandName}
      className="object-cover"
      fill
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
      src={brand.heroImageUrl}
    />
  )
}

function SavedBrandCard({ brand }: { brand: SavedBrand }) {
  return (
    <Link
      className="group block overflow-hidden rounded-xl border border-border bg-white transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={`/brands/${brand.brandSlug}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <BrandImage brand={brand} />
        <div className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-cta shadow-sm">
          <Heart className="h-5 w-5" fill="currentColor" aria-hidden />
        </div>
      </div>
      <div className="p-4">
        <h2 className="truncate type-subsection-title">
          {brand.brandName}
        </h2>
      </div>
    </Link>
  )
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: string
}) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-5 py-16 lg:px-20">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Heart className="h-8 w-8" aria-hidden />
        </div>
        <h2 className="mt-6 type-section-title-large">
          {title}
        </h2>
        <p className="mt-3 type-card-description">
          {description}
        </p>
        <Link
          className={cn(buttonVariants(), 'mt-6')}
          href="/brands"
        >
          {action}
        </Link>
      </div>
    </div>
  )
}

export default async function FavoritesPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('favorites')
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in')
  }

  const brands = await getUserSavedBrands(user.id)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="flex h-16 items-center justify-between gap-4 px-5 lg:px-20">
          <h1 className="type-section-title-large">
            {t('heading')}
          </h1>
          <p className="type-metadata">
            {t('count', { count: brands.length })}
          </p>
        </div>
      </header>

      {brands.length > 0 ? (
        <main className="grid grid-cols-1 gap-6 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:px-20">
          {brands.map((brand) => (
            <SavedBrandCard key={brand.brandId} brand={brand} />
          ))}
        </main>
      ) : (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={t('exploreBrands')}
        />
      )}
    </div>
  )
}
