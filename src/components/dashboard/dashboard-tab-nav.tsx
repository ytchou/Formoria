'use client'

import {
  FileText,
  Home,
  ImageIcon,
  Link2,
  ShieldCheck,
  Star,
  TrendingUp,
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { textStyles } from '@/components/ui/text-styles'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/routes'

type DashboardTabNavProps = {
  brandSlug: string
}

const navItems = [
  { key: 'overview', segment: '', icon: Home },
  { key: 'info', segment: '/info', icon: FileText },
  { key: 'media', segment: '/media', icon: ImageIcon },
  { key: 'links', segment: '/links', icon: Link2 },
  { key: 'verification', segment: '/verification', icon: ShieldCheck },
  { key: 'reputation', segment: '/reputation', icon: Star },
  { key: 'analytics', segment: '/analytics', icon: TrendingUp },
] as const

export function DashboardTabNav({ brandSlug }: DashboardTabNavProps) {
  const pathname = usePathname()
  const t = useTranslations()
  const baseHref = routes.dashboard.brand(brandSlug)

  return (
    <nav aria-label={t('dashboard.sidebar.navLabel')}>
      <div className="scrollbar-hide flex gap-1 overflow-x-auto border-b border-rule">
        {navItems.map((item) => {
          const href = `${baseHref}${item.segment}`
          const isActive = item.segment === ''
            ? pathname === baseHref
            : pathname.startsWith(href)
          const Icon = item.icon

          return (
            <Link
              key={item.key}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative inline-flex min-h-12 flex-none items-center justify-center gap-1.5 whitespace-nowrap px-4 py-2 text-ink-muted transition-[background-color,color] after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-accent after:opacity-0 after:transition-opacity hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:after:transition-none',
                textStyles({ variant: 'navItem' }),
                isActive && 'text-ink after:opacity-100',
              )}
              href={href}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              <span>{t(`dashboard.sidebar.${item.key}`)}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
