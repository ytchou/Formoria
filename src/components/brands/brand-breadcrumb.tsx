import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { ChevronRight } from 'lucide-react'

interface BrandBreadcrumbProps {
  categorySlug: string | null
  categoryLabel: string | null
  brandName: string
}

export async function BrandBreadcrumb({ categorySlug, categoryLabel, brandName }: BrandBreadcrumbProps) {
  const t = await getTranslations('brandDetail')

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <li>
          <Link
            href="/brands"
            className="transition-colors hover:text-foreground"
          >
            {t('breadcrumb.directory')}
          </Link>
        </li>
        {categorySlug && categoryLabel && (
          <>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li>
              <Link
                href={`/brands?category=${encodeURIComponent(categorySlug)}`}
                className="transition-colors hover:text-foreground"
              >
                {categoryLabel}
              </Link>
            </li>
          </>
        )}
        <li aria-hidden="true">
          <ChevronRight className="size-3.5" />
        </li>
        <li>
          <span aria-current="page" className="font-medium text-foreground">
            {brandName}
          </span>
        </li>
      </ol>
    </nav>
  )
}
