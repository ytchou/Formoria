import type { Metadata } from 'next'
import { SurfaceImage } from '@/components/ui/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Heart } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { brandImageFill } from '@/lib/images/fill'
import { selectBrandCardImage } from '@/lib/brands/image-selection'
import { getUserSavedBrands } from '@/lib/services/saved-brands'
import { requireUserPage } from '@/lib/auth/require-user'
import type { SavedBrand } from '@/lib/types/saved-brand'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'
import { Grid } from '@/components/ui/grid'
import { PageShell, shellStyles } from '@/components/ui/page-shell'

type Props = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('favorites')
  return {
    title: t('metadata.title'),
    robots: { index: false, follow: true },
  }
}

function BrandImage({ brand }: { brand: SavedBrand }) {
  const selectedImage = selectBrandCardImage(brand)
  if (!selectedImage) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-deep">
        <span className="type-page-title text-ink-muted">
          {[...brand.brandName][0]}
        </span>
      </div>
    )
  }

  // Shared with every other brand image surface: a logo is contained (its
  // whitespace is part of the mark), everything else covers.
  const imageFill = brandImageFill(selectedImage.meta, { inset: 'p-6' })

  return (
    <SurfaceImage
      alt={selectedImage.meta?.altZh ?? brand.brandName}
      className={imageFill}
      fill
      surface="card"
      src={selectedImage.src}
    />
  )
}

function SavedBrandCard({ brand }: { brand: SavedBrand }) {
  return (
    <Link
      className={surfaceCardStyles({
        className: 'group block overflow-hidden',
        interactive: true,
        padding: 'none',
        tone: 'white',
      })}
      href={routes.brand(brand.brandSlug)}
    >
      <div className="relative aspect-media overflow-hidden bg-surface-deep">
        <BrandImage brand={brand} />
        <div className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-rule bg-ground text-accent">
          <Heart className="h-5 w-5" fill="currentColor" aria-hidden />
        </div>
      </div>
      <div className="p-4">
        <h2 className="truncate type-body-sm font-semibold text-ink">
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
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center page-gutter py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full bg-surface-deep text-ink-muted">
          <Heart className="h-8 w-8" aria-hidden />
        </div>
        <h2 className="mt-6 type-section">
          {title}
        </h2>
        <p className="mt-3 type-body-sm">
          {description}
        </p>
        <Link
          className={cn(buttonVariants(), 'mt-6')}
          href={routes.brands()}
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
  const user = await requireUserPage(routes.favorites(), locale)

  const brands = await getUserSavedBrands(user.id)

  return (
    <div className="min-h-screen bg-ground">
      {/* The rule is full-bleed, the row inside it is on the measure — and
        THE MEASURE is all this header shares with the one `loading.tsx` draws.
        Both containers here were uncapped while that skeleton already capped at
        the measure, so the page jumped wider the moment the real data arrived.
        The skeleton header is `h-14` and sticky under the nav; this one is
        `h-16` and static, so the swap still grows the row 8px and un-sticks it.
        That mismatch predates DEV-1529 and outlives it — closing it moves
        rendered layout, which is a behavioural change, not a width one. */}
      <header className="border-b border-rule bg-ground">
        <PageShell
          measure="page"
          className="flex h-16 items-center justify-between gap-4"
        >
          <h1 className="type-section">
            {t('heading')}
          </h1>
          {brands.length > 0 && (
            <p className="type-metadata">
              {t('count', { count: brands.length })}
            </p>
          )}
        </PageShell>
      </header>

      <main>
        {brands.length > 0 ? (
          // The shell as a class string, not a wrapper: `Grid` owns the
          // element, exactly as `directory-view.tsx` reads it.
          <Grid className={cn(shellStyles({ measure: 'page' }), 'py-stack')}>
            {brands.map((brand) => (
              <SavedBrandCard key={brand.brandId} brand={brand} />
            ))}
          </Grid>
        ) : (
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={t('exploreBrands')}
          />
        )}
      </main>
    </div>
  )
}
