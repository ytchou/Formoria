'use client'

import { Pencil, ShieldCheck, TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { useMounted } from '@/hooks/use-mounted'
import { useUser } from '@/lib/auth/use-user'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'

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
  const mounted = useMounted()
  const t = useTranslations('gettingStarted.forOwners')
  const ctaT = useTranslations('gettingStarted.ctaFooter')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {benefits.map(({ key, Icon }) => (
          <article
            key={key}
            className={surfaceCardStyles({ className: 'space-y-2', padding: 'sm' })}
          >
            <Icon className="size-6 text-primary" aria-hidden="true" />
            <h3 className="type-subsection-title">{t(`${key}.title`)}</h3>
            <p className="type-card-description">{t(`${key}.description`)}</p>
          </article>
        ))}
      </div>

      {mounted && !user && (
        <Link
          href="/submit"
          className={buttonVariants({ variant: 'primary', tone: 'cta' })}
        >
          {ctaT('cta')}
        </Link>
      )}
    </div>
  )
}
