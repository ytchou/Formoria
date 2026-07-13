'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { surfaceCardStyles } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import type { ProfileCompleteness } from '@/lib/services/profile-completeness'

function CompletenessRing({ score }: { score: number }) {
  const normalizedScore = Math.min(100, Math.max(0, score))

  return (
    <span
      aria-label={`${normalizedScore}%`}
      className="relative flex size-12 shrink-0 items-center justify-center"
      role="img"
    >
      <svg aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
        <circle
          className="stroke-muted"
          cx="24"
          cy="24"
          fill="none"
          r="20"
          strokeWidth="4"
        />
        <circle
          className="stroke-primary"
          cx="24"
          cy="24"
          fill="none"
          pathLength="100"
          r="20"
          strokeDasharray="100"
          strokeDashoffset={100 - normalizedScore}
          strokeLinecap="round"
          strokeWidth="4"
        />
      </svg>
      <span className="type-label tabular-nums">
        {normalizedScore}%
      </span>
    </span>
  )
}

export function ProfileCompletenessCard({
  completeness,
  slug,
}: {
  completeness: ProfileCompleteness
  slug: string
}) {
  const t = useTranslations('dashboard.profileCompleteness')
  const [open, setOpen] = useState(true)

  return (
    <section
      id="profile-completeness"
      className={surfaceCardStyles({ className: 'overflow-hidden', padding: 'none' })}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex min-h-12 w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">
          <CompletenessRing score={completeness.score} />
          <span className="min-w-0">
            <span className="block type-subsection-title">
              {t('title')}
            </span>
            <span className="block type-caption">
              {t('completedCount', {
                completed: completeness.completed,
                total: completeness.total,
              })}
            </span>
          </span>
          <span className="ml-auto type-field-label text-primary">
            {open ? t('hideRecommendations') : t('viewRecommendations')}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none${open ? ' rotate-180' : ''}`}
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-border px-5 py-5">
          {completeness.recommendations.length > 0 ? (
            <div className="space-y-3">
              <h3 className="type-subsection-title">
                {t('recommendations')}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {completeness.recommendations.slice(0, 3).map((component) => (
                  <Link
                    key={component.key}
                    href={`/dashboard/brands/${slug}/edit?step=${component.step}`}
                    className="min-w-0 rounded-lg border border-border p-4 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="type-label text-primary">
                      {component.required
                        ? t('priority.required')
                        : t(`priority.weight${component.weight}`)}
                    </span>
                    <span className="mt-1 block type-body-emphasis">
                      {t(`component.${component.key}`)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="type-card-description">{t('complete')}</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
