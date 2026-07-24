import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  HeartPulse,
  Pencil,
} from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import { SurfaceCard } from '@/components/ui/card'

type QuickAction = {
  descriptionKey: string
  href: string
  icon: LucideIcon
  titleKey: string
}

export async function QuickActions({ brandSlug }: { brandSlug: string }) {
  const [tOverview, tWelcome] = await Promise.all([
    getTranslations('dashboard.overview'),
    getTranslations('dashboard.welcome'),
  ])
  const actions: QuickAction[] = [
    {
      descriptionKey: 'quickActions.editProfile.description',
      href: `/dashboard/brands/${brandSlug}/edit`,
      icon: Pencil,
      titleKey: 'tips.editProfile',
    },
    {
      descriptionKey: 'quickActions.checkHealth.description',
      href: '#profile-completeness',
      icon: HeartPulse,
      titleKey: 'tips.checkHealth',
    },
    {
      descriptionKey: 'quickActions.viewAnalytics.description',
      href: `/dashboard/brands/${brandSlug}/analytics`,
      icon: BarChart3,
      titleKey: 'tips.viewAnalytics',
    },
    {
      descriptionKey: 'quickActions.readFaq.description',
      href: '/faq#for-owners',
      icon: BookOpen,
      titleKey: 'tips.readFaq',
    },
  ]

  return (
    <section aria-labelledby="quick-actions-title">
      <h2 className="type-section-title" id="quick-actions-title">
        {tOverview('quickActionsTitle')}
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((action) => {
          const Icon = action.icon

          return (
            <Link
              className="group min-h-12 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={action.href}
              key={action.titleKey}
            >
              <SurfaceCard
                className="flex h-full items-center gap-3 rounded-lg transition-colors group-hover:bg-muted"
                padding="sm"
              >
                <Icon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="type-card-title">
                    {tWelcome(action.titleKey)}
                  </h3>
                  <p className="mt-1 type-body-muted">
                    {tOverview(action.descriptionKey)}
                  </p>
                </div>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </SurfaceCard>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
