import type { Metadata } from 'next'
import { Check, ChevronRight } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import { canManageDashboardBrand } from '@/lib/auth/admin-mode'
import { createClient } from '@/lib/supabase/server'
import { getBrandBySlug } from '@/lib/services/brands'
import {
  getBrandOnboardingProgress,
  ONBOARDING_STEPS,
} from '@/lib/services/brand-onboarding'

type Props = {
  searchParams: Promise<{ brand?: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard.onboarding')
  return { title: t('page.title') }
}

export default async function OnboardingPage({ searchParams }: Props) {
  const { brand: brandSlug } = await searchParams
  if (!brandSlug) redirect('/dashboard')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const brand = await getBrandBySlug(brandSlug)
  if (!(await canManageDashboardBrand(user.id, user.email, brand.id, brand.slug))) {
    redirect('/dashboard')
  }

  const [progress, t] = await Promise.all([
    getBrandOnboardingProgress(brand.id),
    getTranslations('dashboard.onboarding'),
  ])

  return (
    <div className="mx-auto max-w-3xl py-2">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold text-primary">{brand.name}</p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">
          {t('page.title')}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('page.description')}
        </p>

        <div className="mt-6 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(progress.completedCount / ONBOARDING_STEPS.length) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-sm font-medium text-muted-foreground">
            {t('progress', {
              completed: progress.completedCount,
              total: ONBOARDING_STEPS.length,
            })}
          </span>
        </div>

        <ol className="mt-8 divide-y divide-border border-y border-border">
          {progress.steps.map((step, index) => {
            return (
              <li key={step.key}>
                <Link
                  href={`/dashboard/brands/${brand.slug}/edit`}
                  className="group flex w-full items-center gap-4 px-1 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                    <span
                      className={step.status === 'complete'
                        ? 'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
                        : 'flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground'}
                    >
                      {step.status === 'complete' ? <Check className="size-4" /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-foreground">
                        {t(`steps.${step.key}.title`)}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {t(`steps.${step.key}.description`)}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {t(`status.${step.status}`)}
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
