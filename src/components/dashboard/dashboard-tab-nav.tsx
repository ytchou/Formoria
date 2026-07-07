'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

type DashboardTabNavProps = {
  brandSlug: string
}

export function DashboardTabNav({ brandSlug }: DashboardTabNavProps) {
  const t = useTranslations('dashboard.tabs')
  const pathname = usePathname()

  const base = `/dashboard/brands/${brandSlug}`
  const tabs = [
    { key: 'profile' as const, segment: '' },
    { key: 'analytics' as const, segment: '/analytics' },
  ]

  return (
    <nav
      aria-label={t('profile')}
      className="flex min-h-12 gap-6 border-b border-border"
    >
      {tabs.map((tab) => {
        const href = `${base}${tab.segment}`
        const isActive = tab.segment === ''
          ? pathname === base
          : pathname.startsWith(href)

        return (
          <Link
            key={tab.key}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-12 items-center border-b-2 px-1 text-sm font-medium transition-colors',
              isActive
                ? 'border-foreground text-foreground font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            href={href}
          >
            {t(tab.key)}
          </Link>
        )
      })}
    </nav>
  )
}
