import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { ChevronRight } from 'lucide-react'
import type { AppLocale } from '@/i18n/locale-preference'

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
      <ol className="flex items-center gap-1.5 type-body-sm">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="contents">
            {index > 0 ? (
              <ChevronRight aria-hidden="true" className="size-3.5" />
            ) : null}
            {item.href ? (
              <Link
                href={item.href}
                className="transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">
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
        { label: t('breadcrumb.directory'), href: '/brands' },
        ...(categorySlug && categoryLabel
          ? [
              {
                label: categoryLabel,
                href: `/categories/${encodeURIComponent(categorySlug)}`,
              },
            ]
          : []),
        { label: brandName },
      ]}
    />
  )
}
