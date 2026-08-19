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
import { routes } from '@/lib/routes'
import { Grid } from '@/components/ui/grid'

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
      href: routes.dashboard.brandEdit(brandSlug),
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
      href: routes.dashboard.brandSection(brandSlug, 'analytics'),
      icon: BarChart3,
      titleKey: 'tips.viewAnalytics',
    },
    {
      descriptionKey: 'quickActions.readFaq.description',
      href: `${routes.faq()}#for-owners`,
      icon: BookOpen,
      titleKey: 'tips.readFaq',
    },
  ]

  return (
    <section aria-labelledby="quick-actions-title">
      <h2 className="type-label" id="quick-actions-title">
        {tOverview('quickActionsTitle')}
      </h2>
      <Grid className="mt-4">
        {actions.map((action) => {
          const Icon = action.icon

          return (
            <Link
              className="group min-h-12 rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              href={action.href}
              key={action.titleKey}
            >
              <SurfaceCard
                className="flex h-full items-center gap-3 rounded-[3px] transition-colors group-hover:bg-surface"
                padding="sm"
              >
                <Icon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-accent"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="type-label">
                    {tWelcome(action.titleKey)}
                  </h3>
                  <p className="mt-1 type-body-sm">
                    {tOverview(action.descriptionKey)}
                  </p>
                </div>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-ink-muted"
                />
              </SurfaceCard>
            </Link>
          )
        })}
      </Grid>
    </section>
  )
}
