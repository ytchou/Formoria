import { useFormatter, useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import type {
  OriginEvidence,
  OriginEvidenceStatus,
} from '@/lib/services/origin-evidence'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { routes } from '@/lib/routes'

type ContributionsListProps = {
  items: OriginEvidence[]
}

function StatusBadge({ status }: { status: OriginEvidenceStatus }) {
  const t = useTranslations('contributions.status')
  const variant = {
    pending: 'warning',
    approved: 'success',
    rejected: 'destructive',
  } as const

  return <Badge variant={variant[status]}>{t(status)}</Badge>
}

export function ContributionsList({ items }: ContributionsListProps) {
  const t = useTranslations('contributions')
  const format = useFormatter()

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <h2 className="type-section">{t('emptyTitle')}</h2>
        <p className="mx-auto mt-3 max-w-md type-body-sm">
          {t('emptyDescription')}
        </p>
        <Link
          className={buttonVariants({ className: 'mt-6 h-12' })}
          href={routes.brands()}
        >
          {t('exploreBrands')}
        </Link>
      </div>
    )
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => {
        const brandName = item.brandName ?? t('unknownBrand')
        const isSupport = item.stance === 'supports'
        const brandNameElement = item.brandSlug ? (
          <Link
            className="type-body-sm font-semibold text-ink underline-offset-4 hover:underline"
            href={routes.brand(item.brandSlug)}
          >
            {brandName}
          </Link>
        ) : (
          <span className="type-body-sm font-semibold text-ink">{brandName}</span>
        )

        return (
          <li
            className={surfaceCardStyles({
              className: 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between',
              padding: 'md',
            })}
            key={item.id}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'size-2.5 shrink-0 rounded-full',
                    isSupport ? 'bg-verified-green' : 'bg-destructive',
                  )}
                />
                <span
                  className={cn(
                    'type-metadata',
                    isSupport ? 'text-verified-green' : 'text-destructive',
                  )}
                >
                  {t(`stance.${item.stance}`)}
                </span>
              </div>
              <div className="mt-2 truncate">{brandNameElement}</div>
              <time className="mt-1 block type-metadata" dateTime={item.createdAt}>
                {format.dateTime(new Date(item.createdAt), { dateStyle: 'medium' })}
              </time>
            </div>
            <StatusBadge status={item.status} />
          </li>
        )
      })}
    </ul>
  )
}
