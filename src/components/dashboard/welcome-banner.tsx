'use client'

import { ArrowRight, Check, Circle, ListChecks } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { startOnboardingStepAction } from '@/lib/actions/brand-onboarding'
import { ONBOARDING_STEPS, type OnboardingStep, type OnboardingStepKey } from '@/lib/services/brand-onboarding'

type WelcomeBannerProps = {
  completedCount: number
  nextStep: OnboardingStepKey | null
  slug: string
  steps: OnboardingStep[]
}

export function WelcomeBanner({
  completedCount,
  nextStep,
  slug,
  steps,
}: WelcomeBannerProps) {
  const t = useTranslations('dashboard.onboarding')

  const percentage = (completedCount / ONBOARDING_STEPS.length) * 100

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ListChecks className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-bold text-foreground">
            {t('card.title')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('progress', { completed: completedCount, total: ONBOARDING_STEPS.length })}
          </p>
        </div>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t('card.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={ONBOARDING_STEPS.length}
        aria-valuenow={completedCount}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <ol className="mt-5 space-y-2">
        {steps.map((step, index) => {
          const isNext = step.key === nextStep
          const startAction = startOnboardingStepAction.bind(null, slug, step.key)

          return (
            <li key={step.key}>
              <form action={startAction}>
                <button
                  type="submit"
                  className={`group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    isNext
                      ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
                      : 'border-transparent hover:bg-muted'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                      step.status === 'complete'
                        ? 'bg-primary text-primary-foreground'
                        : isNext
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step.status === 'complete' ? (
                      <Check className="size-3.5" />
                    ) : isNext ? (
                      <span className="text-xs font-bold">{index + 1}</span>
                    ) : (
                      <Circle className="size-3" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">
                      {t(`steps.${step.key}.title`)}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t(`steps.${step.key}.description`)}
                    </span>
                    <span className="mt-1.5 block text-xs font-medium text-primary">
                      {t(`status.${step.status}`)}
                    </span>
                  </span>
                  {isNext ? (
                    <ArrowRight className="mt-1 size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
                  ) : null}
                </button>
              </form>
            </li>
          )
        })}
      </ol>

      <Link
        href={`/dashboard/onboarding?brand=${slug}`}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t('card.viewAll')}
      </Link>
    </section>
  )
}
