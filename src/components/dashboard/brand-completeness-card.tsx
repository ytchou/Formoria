import { Check, PartyPopper } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  BrandCompleteness,
  CompletenessItem,
} from '@/lib/services/brand-completeness'

type BrandCompletenessCardProps = {
  completeness: BrandCompleteness
  slug: string
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
  const isComplete = completeness.completed === completeness.total
  const progressWidth = `${Math.round(completeness.fraction * 100)}%`

  return (
    <Card className="border-[#E5E0D8] bg-white shadow-none">
      <CardHeader className="gap-3 pb-4">
        <div className="space-y-1 text-left">
          <CardTitle className="text-base font-bold text-foreground">
            {t('dashboard.completeness.title')}
          </CardTitle>
          <p
            className={isComplete ? 'text-sm text-primary' : 'text-sm text-muted-foreground'}
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
            className="h-2 rounded-full bg-primary"
            style={{ width: progressWidth }}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-left">
        {isComplete ? (
          <div className="flex items-start gap-3">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EAF3E8]">
              <PartyPopper className="h-[18px] w-[18px] text-[#2F5D50]" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-primary">
              {t('dashboard.completeness.complete')}
            </p>
          </div>
        ) : null}

        {incomplete.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">
              {t('dashboard.completeness.toComplete')}
            </p>
            <div className="space-y-3">
              {incomplete.map((item) => (
                <div
                  key={item.key}
                  className="flex items-start justify-between gap-3"
                  data-key={item.key}
                  data-testid="completeness-item"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="h-4 w-4 shrink-0 rounded-full border border-[#C7C2BB]" />
                    <div className="space-y-1">
                      <p className="text-[14px] font-semibold text-foreground">
                        {t(`dashboard.completeness.items.${item.key}.label`)}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        {t(`dashboard.completeness.items.${item.key}.nudge`)}
                      </p>
                    </div>
                  </div>
                  <a
                    className="inline-flex min-h-[44px] shrink-0 items-center px-2 text-sm font-semibold text-[#C25B3F] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    href={`/dashboard/brands/${slug}/edit${item.anchor}`}
                  >
                    {t('dashboard.completeness.editCta')}
                  </a>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {complete.length > 0 ? (
          <>
            <div className="h-px w-full bg-[#E5E0D8]" />

            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">
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
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EAF3E8]">
                      <Check className="h-3 w-3 text-[#2D5A27]" aria-hidden="true" />
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
