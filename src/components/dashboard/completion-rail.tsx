import { ChevronRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import type { ProfileCompleteness } from '@/lib/services/profile-completeness'

export async function CompletionRail({
  completeness,
  slug,
  mitStatus,
}: {
  completeness: ProfileCompleteness
  slug: string
  mitStatus: string
}) {
  const [tOverview, tProfile] = await Promise.all([
    getTranslations('dashboard.overview'),
    getTranslations('dashboard.profileCompleteness'),
  ])
  const recommendation = completeness.recommendations.at(0)
  const featuredTodo = recommendation
    ? {
        href: `/dashboard/brands/${slug}/edit?step=${recommendation.step}`,
        label: tProfile(`component.${recommendation.key}`),
      }
    : mitStatus !== 'verified'
      ? {
          href: `/dashboard/brands/${slug}/verification`,
          label: tOverview('todoVerification'),
        }
      : null

  return (
    <SurfaceCard data-mit-status={mitStatus} padding="lg">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <p className="type-card-title">{tOverview('completionTitle')}</p>
          <p className="mt-2 type-stat-large">{completeness.score}%</p>
          <div
            aria-label={tOverview('completionTitle')}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={completeness.score}
            className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, completeness.score))}%` }}
            />
          </div>
          <p className="mt-2 type-caption text-muted-foreground">
            {tOverview('completedCount', {
              completed: completeness.completed,
              total: completeness.total,
            })}
          </p>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          {completeness.score < 100 ? (
            <p className="rounded-lg bg-warning/10 p-3 type-body text-warning">
              {tOverview('warningIncomplete', {
                count: completeness.recommendations.length,
              })}
            </p>
          ) : null}
          {featuredTodo ? (
            <Link
              className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-3 type-body hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              href={featuredTodo.href}
            >
              <span>{featuredTodo.label}</span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          ) : null}
          <Button
            className="min-h-12 w-full"
            nativeButton={false}
            render={<Link href="#profile-completeness" />}
            variant="secondary"
          >
            {tOverview('viewAllTodos')}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  )
}
