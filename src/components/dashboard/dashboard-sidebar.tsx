'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import {
  FileText,
  Home,
  ImageIcon,
  Link2,
  ShieldCheck,
  Star,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CompletenessRing } from '@/components/dashboard/completeness-ring'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

export type DashboardSidebarProps = {
  brandName: string
  brandNameEn: string | null
  brandSlug: string
  brandLogoUrl: string | null
  mitStatus: 'unverified' | 'declared' | 'verified'
  completenessScore: number
  completenessTotal: number
  completenessCompleted: number
  className?: string
}

export function DashboardSidebar({
  brandName,
  brandNameEn,
  brandSlug,
  brandLogoUrl,
  mitStatus,
  completenessScore,
  completenessTotal,
  completenessCompleted,
  className = 'hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col',
}: DashboardSidebarProps) {
  const t = useTranslations('dashboard.sidebar')
  const tMitStatus = useTranslations('dashboard.mit.status')
  const pathname = usePathname()
  const baseHref = `/dashboard/brands/${brandSlug}`
  const navItems = [
    { key: 'overview', segment: '', icon: Home },
    { key: 'info', segment: '/info', icon: FileText },
    { key: 'media', segment: '/media', icon: ImageIcon },
    { key: 'links', segment: '/links', icon: Link2 },
    { key: 'verification', segment: '/verification', icon: ShieldCheck },
    { key: 'reputation', segment: '/reputation', icon: Star },
    { key: 'analytics', segment: '/analytics', icon: TrendingUp },
  ] as const
  const isIncomplete = completenessCompleted < completenessTotal

  return (
    <aside className={cn(className)}>
      <div className="flex items-center gap-3 border-b border-border p-4">
        <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {brandLogoUrl ? (
            <Image
              alt={brandName}
              className="size-full object-cover"
              height={48}
              src={brandLogoUrl}
              width={48}
            />
          ) : (
            <span aria-hidden="true" className="type-section-title text-muted-foreground">
              {brandName.slice(0, 1)}
            </span>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="truncate type-body-emphasis">{brandName}</p>
          {brandNameEn && brandNameEn !== brandName ? (
            <p className="truncate type-caption">{brandNameEn}</p>
          ) : null}
          <Badge variant={mitStatus === 'verified' ? 'verified' : 'secondary'}>
            {tMitStatus(mitStatus)}
          </Badge>
        </div>
      </div>

      <nav aria-label={t('navLabel')} className="flex-1 py-3">
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
                'flex min-h-12 items-center gap-3 border-l-2 border-transparent px-4 type-nav-item transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-primary border-l-2 border-primary font-medium'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
              )}
              href={href}
            >
              <Icon aria-hidden="true" className="size-5 shrink-0" />
              <span>{t(item.key)}</span>
            </Link>
          )
        })}
      </nav>

      <div className="space-y-4 border-t border-border p-4">
        <div className="flex items-center gap-3">
          <CompletenessRing score={completenessScore} />
          <div className="min-w-0">
            <p className="type-body-emphasis">{t('completenessTitle')}</p>
            <p className="type-caption tabular-nums">
              {completenessCompleted} / {completenessTotal}
            </p>
          </div>
        </div>
        {isIncomplete ? (
          <Link className="block min-h-12 type-link" href={`${baseHref}#profile-completeness`}>
            {t('viewMissing')}
          </Link>
        ) : null}
        <div className="space-y-2 border-t border-border pt-4">
          <Link className="flex min-h-12 items-center type-link" href={`/brands/${brandSlug}`}>
            {t('viewBrandPage')}
          </Link>
          <Link className="flex min-h-12 items-center type-link" href={`${baseHref}/edit`}>
            {t('editBrand')}
          </Link>
        </div>
      </div>
    </aside>
  )
}
