'use client'

import {
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleUser,
  Image,
  MousePointerClick,
  PencilLine,
  Share2,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Link } from '@/i18n/navigation'
import type { BrandCompleteness, CompletenessItem } from '@/lib/services/brand-completeness'
import type {
  ActionNudge,
  BrandHealthScore,
  DimensionKey,
  DimensionScore,
} from '@/lib/services/brand-health'

type BrandHealthCardProps = {
  health: BrandHealthScore
  completeness: BrandCompleteness
  slug: string
}

const dimensionIcons: Record<DimensionKey, typeof CircleUser> = {
  profileCompleteness: CircleUser,
  engagementHealth: TrendingUp,
  brandStory: BookOpen,
  photoQuality: Camera,
  socialPresence: Share2,
  purchaseAccessibility: ShoppingBag,
  clickThroughRate: MousePointerClick,
}

const actionIcons: Record<string, typeof CircleUser> = {
  camera: Camera,
  'share-2': Share2,
  'book-open': BookOpen,
  image: Image,
  'circle-user': CircleUser,
}

function formatWeight(weight: number) {
  return `${Math.round(weight * 100)}%`
}

function actionIcon(action: ActionNudge) {
  return actionIcons[action.icon] ?? dimensionIcons[action.key] ?? PencilLine
}

function progressWidth(dimension: DimensionScore) {
  return `${dimension.coldStart ? 0 : Math.max(0, Math.min(100, dimension.score))}%`
}

export function BrandHealthCard({ health, completeness, slug }: BrandHealthCardProps) {
  const t = useTranslations('dashboard.health')
  const tCompleteness = useTranslations('dashboard.completeness.items')
  const editHref = `/dashboard/brands/${slug}/edit`

  return (
    <Card className="border-[#E5E0D8] bg-[#FFFFFF] shadow-none">
      <CardHeader className="gap-4 pb-4">
        <div className="flex items-start gap-4">
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-primary text-[1.75rem] font-bold leading-none text-white">
            {health.overall}
          </div>
          <div className="min-w-0 flex-1 space-y-2 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base font-bold text-[#1C1C1C]">
                {t('title')}
              </CardTitle>
              <Badge className="bg-[#F5F4F1] text-[#2F5D50]" variant="secondary">
                {t(`tier.${health.tier}`)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
            <p className="text-xs font-medium text-[#2F5D50]">
              {t(`tierRange.${health.tier}`)}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-left">
        <div className="h-px w-full bg-[#E5E0D8]" />

        {health.topActions.length > 0 ? (
          <>
            <section className="space-y-3">
              <h4 className="text-sm font-semibold text-[#1C1C1C]">
                {t('actionQueue.title')}
              </h4>
              <div className="space-y-2">
                {health.topActions.map((action) => {
                  const Icon = actionIcon(action)

                  return (
                    <Link
                      className="flex items-center justify-between gap-3 rounded-md border border-[#E5E0D8] px-3 py-2 hover:bg-[#F5F4F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFFFF]"
                      href={`${editHref}${action.anchor}`}
                      key={`${action.dimension}-${action.anchor}`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F5F4F1]">
                          <Icon className="h-4 w-4 text-[#2F5D50]" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 text-sm font-semibold text-[#1C1C1C]">
                          {action.label}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-[#2F5D50]">
                        +{action.points} pts
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>

            <div className="h-px w-full bg-[#E5E0D8]" />
          </>
        ) : null}

        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-[#1C1C1C]">
            {t('scoreBreakdown')}
          </h4>
          <div className="space-y-3">
            {health.dimensions.map((dimension) => {
              const Icon = dimensionIcons[dimension.key]

              return (
                <div
                  className="space-y-2"
                  data-testid="health-dimension"
                  key={dimension.key}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-[#2F5D50]" aria-hidden="true" />
                      <span className="min-w-0 text-sm font-semibold text-[#1C1C1C]">
                        {t(`dimension.${dimension.key}`)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatWeight(dimension.weight)}
                      </span>
                      {dimension.coldStart ? (
                        <div className="text-right">
                          <Badge variant="outline">{t('coldStart')}</Badge>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('coldStartHint')}
                          </p>
                        </div>
                      ) : (
                        <span className="w-8 text-right text-sm font-semibold text-[#1C1C1C]">
                          {dimension.score}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#F5F4F1]">
                    <div
                      aria-label={t(`dimension.${dimension.key}`)}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={dimension.coldStart ? 0 : dimension.score}
                      className="h-2 rounded-full bg-[#2F5D50]"
                      role="progressbar"
                      style={{ width: progressWidth(dimension) }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <div className="h-px w-full bg-[#E5E0D8]" />

        <Collapsible defaultOpen>
          <section className="space-y-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
              <h4 className="text-sm font-semibold text-[#1C1C1C]">
                {t('drillDown.title')}
              </h4>
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2">
              {completeness.items.map((item: CompletenessItem) => (
                <div
                  className="flex items-center gap-3"
                  data-testid="completeness-checklist-item"
                  key={item.key}
                >
                  {item.complete ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2F5D50]" aria-hidden="true" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-[#A8A098]" aria-hidden="true" />
                  )}
                  <span
                    className={
                      item.complete
                        ? 'text-sm font-medium text-muted-foreground'
                        : 'text-sm font-semibold text-[#1C1C1C]'
                    }
                  >
                    {tCompleteness(`${item.key}.label`)}
                  </span>
                </div>
              ))}
            </CollapsibleContent>
          </section>
        </Collapsible>

        <div className="h-px w-full bg-[#E5E0D8]" />

        <Link
          className="inline-flex min-h-[48px] items-center gap-2 text-sm font-semibold text-[#2F5D50] hover:text-[#1F3F36] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFFFF]"
          href={editHref}
        >
          <PencilLine className="h-4 w-4" aria-hidden="true" />
          {t('editProfile')}
        </Link>
      </CardContent>
    </Card>
  )
}
