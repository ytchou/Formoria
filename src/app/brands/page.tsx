import { Suspense } from 'react'
import { getBrands } from '@/lib/services/brands'
import { getTags } from '@/lib/services/taxonomy'
import { TaxonomyFilterSidebar } from '@/components/brands/taxonomy-filter-sidebar'
import { BrandGrid } from '@/components/brands/brand-grid'

export const metadata = {
  title: 'Brand Directory — MIT Map',
  description: 'Discover curated Made in Taiwan brands across all categories',
}

// ISR: revalidate every hour
export const revalidate = 3600

/**
 * Server component: fetches all approved brands and taxonomy tags,
 * then renders the sidebar (client) and grid (client) in a single layout.
 *
 * Client-side filtering via URL ?tags= param — no full page reload needed.
 */
export default async function BrandsPage() {
  const [brands, tags] = await Promise.all([
    getBrands({ status: 'approved' }),
    getTags(),
  ])

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold leading-tight text-foreground">
          Brand Directory
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {brands.length} Made in Taiwan brand{brands.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Layout: sidebar + grid */}
      <div className="flex gap-8">
        {/*
          Suspense boundary required because TaxonomyFilterSidebar uses
          useSearchParams() internally (client component).
        */}
        <Suspense fallback={<div className="hidden md:block w-52 shrink-0" />}>
          <TaxonomyFilterSidebar tags={tags} />
        </Suspense>

        {/* Brand grid — also uses useSearchParams for client filtering */}
        <div className="min-w-0 flex-1">
          <Suspense
            fallback={
              <div
                className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4"
                aria-label="Loading brands..."
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card">
                    <div className="aspect-[4/3] animate-pulse rounded-t-xl bg-muted" />
                    <div className="p-4">
                      <div className="h-4 animate-pulse rounded bg-muted" />
                      <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            }
          >
            <BrandGrid brands={brands} />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
