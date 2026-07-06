'use client'

import { useState } from 'react'
import {
  BookOpen,
  Camera,
  ChevronDown,
  CircleUser,
  MousePointerClick,
  Share2,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Link } from '@/i18n/navigation'
import type { BrandHealthScore, HealthTier } from '@/lib/services/brand-health'

type HealthSummaryCardProps = {
  health: BrandHealthScore
  slug: string
}

const NEXT_TIER: Record<HealthTier, { threshold: number; label: string }> = {
  gettingStarted: { threshold: 40, label: 'growing' },
  growing: { threshold: 70, label: 'thriving' },
  thriving: { threshold: 90, label: 'exemplary' },
  exemplary: { threshold: 100, label: 'exemplary' },
}

const ACTION_ICONS: Record<string, typeof CircleUser> = {
  'circle-user': CircleUser,
  'trending-up': TrendingUp,
  'book-open': BookOpen,
  camera: Camera,
  'share-2': Share2,
  'shopping-bag': ShoppingBag,
  'mouse-pointer-click': MousePointerClick,
}

export function HealthSummaryCard({ health, slug }: HealthSummaryCardProps) {
  const t = useTranslations('dashboard.health')
  const [open, setOpen] = useState(true)

  const nextTier = NEXT_TIER[health.tier]
  const pointsToNext = nextTier.threshold - health.overall
  const isExemplary = health.tier === 'exemplary'

  const smallDash = (health.overall / 100) * 75.4
  const largeDash = (health.overall / 100) * 226.2

  return (
    <div id="health" className="border rounded-lg bg-card shadow-sm overflow-hidden">
      <Collapsible open={open} onOpenChange={(v) => setOpen(v)}>
        <CollapsibleTrigger className="w-full flex items-center gap-3.5 px-5 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
          <svg
            aria-hidden="true"
            className="shrink-0"
            height={32}
            viewBox="0 0 32 32"
            width={32}
          >
            <circle
              className="text-muted/20"
              cx={16}
              cy={16}
              fill="none"
              r={12}
              stroke="currentColor"
              strokeWidth={3}
            />
            <circle
              className="text-primary"
              cx={16}
              cy={16}
              fill="none"
              r={12}
              stroke="currentColor"
              strokeDasharray={`${smallDash} 75.4`}
              strokeLinecap="round"
              strokeWidth={3}
              transform="rotate(-90 16 16)"
            />
          </svg>

          <span className="font-bold text-lg tabular-nums">{health.overall}</span>
          <span className="text-sm text-muted-foreground">{t(`tier.${health.tier}`)}</span>

          <span className="ml-auto text-xs text-muted-foreground">
            {isExemplary
              ? t('atTopTier')
              : t('pointsToNextTier', {
                  points: pointsToNext,
                  tier: t(`tier.${nextTier.label}`),
                })}
          </span>

          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200${open ? ' rotate-180' : ''}`}
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="px-5 pb-5 border-t">
          <div className="pt-5 flex flex-col items-center gap-2">
            <div className="relative" style={{ width: 88, height: 88 }}>
              <svg
                aria-hidden="true"
                height={88}
                viewBox="0 0 88 88"
                width={88}
              >
                <circle
                  className="text-muted/20"
                  cx={44}
                  cy={44}
                  fill="none"
                  r={36}
                  stroke="currentColor"
                  strokeWidth={7}
                />
                <circle
                  className="text-primary"
                  cx={44}
                  cy={44}
                  fill="none"
                  r={36}
                  stroke="currentColor"
                  strokeDasharray={`${largeDash} 226.2`}
                  strokeLinecap="round"
                  strokeWidth={7}
                  transform="rotate(-90 44 44)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold tabular-nums leading-none">
                  {health.overall}
                </span>
                <span className="text-xs text-muted-foreground">/100</span>
              </div>
            </div>

            <p className="text-base font-semibold">{t(`tier.${health.tier}`)}</p>

            {isExemplary ? (
              <p className="text-sm text-muted-foreground">{t('atTopTier')}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                <span className="text-green-600 dark:text-green-400 font-semibold tabular-nums">
                  {pointsToNext}
                </span>{' '}
                {t('pointsToNextTier', {
                  points: '',
                  tier: t(`tier.${nextTier.label}`),
                })
                  .trimStart()}
              </p>
            )}

            <p className="text-xs text-muted-foreground">{t(`tierRange.${health.tier}`)}</p>
          </div>

          {health.topActions.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="uppercase tracking-wide text-xs text-muted-foreground">
                {t('suggestedActions')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {health.topActions.slice(0, 3).map((action) => {
                  const Icon = ACTION_ICONS[action.icon] ?? CircleUser
                  return (
                    <Link
                      className="block border rounded-md border-l-[3px] border-l-amber-500 p-3 hover:bg-muted/50 transition-colors"
                      href={`/dashboard/brands/${slug}/edit${action.anchor}`}
                      key={`${action.dimension}-${action.anchor}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-amber-50 dark:bg-amber-900/20">
                          <Icon
                            aria-hidden="true"
                            className="h-4 w-4 text-amber-600 dark:text-amber-400"
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">
                            {t(`actionQueue.label.${action.labelKey}`)}
                          </p>
                          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                            +{action.points} pts
                          </p>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
