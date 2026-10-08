import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { ChevronRight } from 'lucide-react'
import type { AppLocale } from '@/i18n/locale-preference'
import { routes } from '@/lib/routes'

interface BrandBreadcrumbProps {
  locale: AppLocale
  categorySlug: string | null
  categoryLabel: string | null
  brandName: string
}

export type BreadcrumbItem = { label: string; href?: string }

export function Breadcrumb({
  ariaLabel,
  items,
}: {
  ariaLabel: string
  items: BreadcrumbItem[]
}) {
  return (
    <nav aria-label={ariaLabel} className="mb-6">
      {/* Ancestors and chevrons never shrink, so a narrow viewport wraps the
          row between crumbs instead of splitting a word; only the current
          page may wrap or truncate. Prefetch is off: crumbs point at the
          directory, whose prefetches drew 429s under concurrent crawls. */}
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 type-body-sm">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="contents">
            {index > 0 ? (
              <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
            ) : null}
            {item.href ? (
              <Link
                href={item.href}
                prefetch={false}
                className="shrink-0 whitespace-nowrap transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current="page"
                className="min-w-0 truncate font-medium text-ink"
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export async function BrandBreadcrumb({ locale, categorySlug, categoryLabel, brandName }: BrandBreadcrumbProps) {
  const t = await getTranslations({ locale, namespace: 'brandDetail' })

  return (
    <Breadcrumb
      ariaLabel={t('breadcrumb.ariaLabel')}
      items={[
        { label: t('breadcrumb.directory'), href: routes.brands() },
        ...(categorySlug && categoryLabel
          ? [
              {
                label: categoryLabel,
                href: routes.brands({ category: categorySlug }),
              },
            ]
          : []),
        { label: brandName },
      ]}
    />
  )
}
