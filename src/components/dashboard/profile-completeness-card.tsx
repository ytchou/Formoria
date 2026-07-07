'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Link } from '@/i18n/navigation'
import type { ProfileCompleteness } from '@/lib/services/profile-completeness'

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
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex min-h-12 w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">
          <span className="text-lg font-bold tabular-nums">
            {completeness.score}%
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              {t('title')}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('completedCount', {
                completed: completeness.completed,
                total: completeness.total,
              })}
            </span>
          </span>
          <span className="ml-auto text-xs font-medium text-primary">
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
              <h3 className="text-sm font-semibold text-foreground">
                {t('recommendations')}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {completeness.recommendations.slice(0, 3).map((component) => (
                  <Link
                    key={component.key}
                    href={`/dashboard/brands/${slug}/edit?step=${component.step}`}
                    className="min-w-0 rounded-lg border border-border p-4 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="text-xs font-semibold text-primary">
                      {component.required
                        ? t('priority.required')
                        : t(`priority.weight${component.weight}`)}
                    </span>
                    <span className="mt-1 block text-sm font-medium text-foreground">
                      {t(`component.${component.key}`)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('complete')}</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
