import { Check, PartyPopper } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MilestoneTracker } from '@/components/dashboard/milestone-tracker'
import type {
  BrandCompleteness,
  CompletenessItem,
} from '@/lib/services/brand-completeness'
import { TIER_1_COUNT } from '@/lib/services/brand-completeness'

type BrandCompletenessCardProps = {
  completeness: BrandCompleteness
  slug: string
}

function getMilestoneKey(completeness: BrandCompleteness) {
  if (completeness.completed === completeness.total) {
    return 'dashboard.onboarding.milestone.complete'
  }

  if (completeness.completed >= TIER_1_COUNT) {
    return 'dashboard.onboarding.milestone.halfway'
  }

  if (completeness.completed >= 1 && completeness.completed <= 3) {
    return 'dashboard.onboarding.milestone.gettingStarted'
  }

  return null
}

function sortItems(items: CompletenessItem[]) {
  const incomplete: CompletenessItem[] = []
  const complete: CompletenessItem[] = []

  for (const item of items) {
    if (item.complete) {
      complete.push(item)
    } else {
      incomplete.push(item)
    }
  }

  return { incomplete, complete }
}

export async function BrandCompletenessCard({
  completeness,
  slug,
}: BrandCompletenessCardProps) {
  const t = await getTranslations()
  const { incomplete, complete } = sortItems(completeness.items)
  const tier1Items = completeness.tier1Items ?? completeness.items.slice(0, TIER_1_COUNT)
  const tier2Items = completeness.tier2Items ?? completeness.items.slice(TIER_1_COUNT)
  const isComplete = completeness.completed === completeness.total
  const milestoneKey = getMilestoneKey(completeness)
  const progressWidth = `${Math.round(completeness.fraction * 100)}%`
  const renderTierSection = (labelKey: string, items: CompletenessItem[]) => {
    const tierIncomplete = items.filter((item) => !item.complete)

    if (tierIncomplete.length === 0) {
      return null
    }

    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-[#1C1C1C]">
          {t(labelKey)}
        </p>
        <div className="space-y-3">
          {tierIncomplete.map((item) => (
            <div
              key={item.key}
              className="flex items-start justify-between gap-3"
              data-key={item.key}
              data-testid="completeness-item"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="h-4 w-4 shrink-0 rounded-full border border-[#E5E0D8]" />
                <div className="space-y-1">
                  <p className="text-[14px] font-semibold text-[#1C1C1C]">
                    {t(`dashboard.completeness.items.${item.key}.label`)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`dashboard.completeness.items.${item.key}.hint`)}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {t(`dashboard.completeness.items.${item.key}.nudge`)}
                  </p>
                </div>
              </div>
              <a
                className="inline-flex min-h-[48px] shrink-0 items-center px-2 text-sm font-semibold text-[#2F5D50] hover:text-[#1F3F36] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5D50] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFFFF]"
                href={`/dashboard/brands/${slug}/edit${item.anchor}`}
              >
                {t('dashboard.completeness.editCta')}
              </a>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Card className="border-[#E5E0D8] bg-[#FFFFFF] shadow-none">
      <MilestoneTracker milestone={milestoneKey} slug={slug} />
      <CardHeader className="gap-3 pb-4">
        <div className="space-y-1 text-left">
          <CardTitle className="text-base font-bold text-[#1C1C1C]">
            {t('dashboard.completeness.title')}
          </CardTitle>
          <p
            className={isComplete ? 'text-sm text-[#2F5D50]' : 'text-sm text-[#1C1C1C]'}
          >
            {t('dashboard.completeness.summary', {
              completed: completeness.completed,
              total: completeness.total,
            })}
          </p>
        </div>
        <div
          aria-label="Profile completeness"
          aria-valuemax={completeness.total}
          aria-valuemin={0}
          aria-valuenow={completeness.completed}
          className="h-2 w-full rounded-full bg-[#F5F4F1]"
          role="progressbar"
        >
          <div
            className="h-2 rounded-full bg-[#2F5D50]"
            style={{ width: progressWidth }}
          />
        </div>
        {milestoneKey ? (
          <div className="rounded-md border border-[#E5E0D8] bg-[#F5F4F1] px-3 py-2">
            <p className="text-sm font-semibold text-[#2F5D50]">
              {t(milestoneKey)}
            </p>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4 text-left">
        {isComplete ? (
          <div className="flex items-start gap-3">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F5F4F1]">
              <PartyPopper className="h-[18px] w-[18px] text-[#2F5D50]" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-[#2F5D50]">
              {t('dashboard.completeness.complete')}
            </p>
          </div>
        ) : null}

        {incomplete.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[#1C1C1C]">
              {t('dashboard.completeness.toComplete')}
            </p>
            {renderTierSection('dashboard.onboarding.tier1Label', tier1Items)}
            {renderTierSection('dashboard.onboarding.tier2Label', tier2Items)}
          </div>
        ) : null}

        {complete.length > 0 ? (
          <>
            <div className="h-px w-full bg-[#E5E0D8]" />

            <div className="space-y-3">
              <p className="text-sm font-semibold text-[#1C1C1C]">
                {t('dashboard.completeness.completed')}
              </p>
              <div className="space-y-3">
                {complete.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-start gap-3"
                    data-key={item.key}
                    data-testid="completeness-item"
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F5F4F1]">
                      <Check className="h-3 w-3 text-[#2F5D50]" aria-hidden="true" />
                    </div>
                    <p className="text-[14px] font-medium text-muted-foreground">
                      {t(`dashboard.completeness.items.${item.key}.label`)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
