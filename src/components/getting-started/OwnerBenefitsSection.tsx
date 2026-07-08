'use client'

import { Pencil, ShieldCheck, TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { useUser } from '@/lib/auth/use-user'
import { buttonVariants } from '@/components/ui/button'

const benefits = [
  {
    key: 'claim',
    Icon: ShieldCheck,
  },
  {
    key: 'manage',
    Icon: Pencil,
  },
  {
    key: 'track',
    Icon: TrendingUp,
  },
] as const

export function OwnerBenefitsSection() {
  const { user } = useUser()
  const t = useTranslations('gettingStarted.forOwners')
  const ctaT = useTranslations('gettingStarted.ctaFooter')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {benefits.map(({ key, Icon }) => (
          <article key={key} className="space-y-2 rounded-xl border border-border bg-card p-4">
            <Icon className="size-6 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">{t(`${key}.title`)}</h3>
            <p className="text-sm text-muted-foreground">{t(`${key}.description`)}</p>
          </article>
        ))}
      </div>

      {!user && (
        <Link
          href="/submit"
          className={buttonVariants({ variant: 'cta' })}
        >
          {ctaT('cta')}
        </Link>
      )}
    </div>
  )
}
