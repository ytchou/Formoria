'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

type DashboardTabNavProps = {
  brandSlug: string
}

const tabs = [
  { key: 'profile', href: '/dashboard' },
  { key: 'analytics', href: '/dashboard/analytics' },
  { key: 'health', href: '/dashboard/health' },
  { key: 'verification', href: '/dashboard/verification' },
] as const

export function DashboardTabNav({ brandSlug }: DashboardTabNavProps) {
  const t = useTranslations('dashboard.tabs')
  const pathname = usePathname()

  return (
    <nav
      aria-label={t('profile')}
      className="flex min-h-12 gap-6 border-b border-border"
    >
      {tabs.map((tab) => {
        const isActive = pathname === tab.href

        return (
          <Link
            key={tab.key}
            className={cn(
              'inline-flex min-h-12 items-center border-b-2 px-1 text-sm font-medium transition-colors',
              isActive
                ? 'border-cta text-foreground font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            href={`${tab.href}?brand=${brandSlug}`}
          >
            {t(tab.key)}
          </Link>
        )
      })}
    </nav>
  )
}
