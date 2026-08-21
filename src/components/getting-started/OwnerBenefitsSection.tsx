import { Pencil, ShieldCheck, TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { routes } from '@/lib/routes'

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
  const t = useTranslations('gettingStarted.forOwners')
  const ctaT = useTranslations('gettingStarted.ctaFooter')

  return (
    // `prose-measure` for the same reason the tips list beside it carries one:
    // this is the right-hand track of getting-started's two-track section, and
    // nothing between the route shell and here sets a width. It sits on the
    // component's own root rather than on a wrapper at the call site because
    // the component is rendered in exactly one place and a wrapper would only
    // add an element to hold one class.
    <div className="prose-measure space-y-5">
      <p className="type-body-sm">{t('comingSoon')}</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {benefits.map(({ key, Icon }) => (
          <article
            key={key}
            className={surfaceCardStyles({ className: 'space-y-2', padding: 'sm' })}
          >
            <Icon className="size-6 text-accent" aria-hidden="true" />
            <h3 className="type-body-sm font-semibold text-ink">{t(`${key}.title`)}</h3>
            <p className="type-body-sm">{t(`${key}.description`)}</p>
          </article>
        ))}
      </div>

      {/* Owner tools are not open yet, so the only action here is registering
          interest on the feature request board — shown to every visitor, since
          signed-in owners have no dashboard to be sent to either. */}
      <Link
        href={routes.featureRequests()}
        className={buttonVariants({ variant: 'primary' })}
      >
        {ctaT('cta')}
      </Link>
    </div>
  )
}
