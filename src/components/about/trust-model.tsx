import { BadgeCheck, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface TrustPillar {
  key: 'pillar1' | 'pillar2' | 'pillar3'
  icon: LucideIcon
}

const trustPillars: [TrustPillar, TrustPillar, TrustPillar] = [
  {
    key: 'pillar1',
    icon: Users,
  },
  {
    key: 'pillar2',
    icon: BadgeCheck,
  },
  {
    key: 'pillar3',
    icon: ShieldCheck,
  },
]

export function TrustModel() {
  const t = useTranslations('about.trust')

  return (
    <section className="border-t border-border py-16 md:py-24">
      <div className="page-gutter mx-auto max-w-5xl">
        <h2 className="type-page-title-large">
          {t('heading')}
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
          {trustPillars.map(({ key, icon: Icon }) => (
            <div key={key} className="border-t border-border pt-5">
              <Icon className="text-cta" size={24} aria-hidden="true" />
              <h3 className="mt-5 type-card-title">
                {t(`${key}.title`)}
              </h3>
              <p className="mt-3 type-body-muted">
                {t(`${key}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
