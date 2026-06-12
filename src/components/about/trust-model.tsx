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
      <div className="mx-auto max-w-5xl px-6 md:px-8">
        <h2 className="font-heading text-3xl font-bold leading-tight text-foreground md:text-4xl">
          {t('heading')}
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {t('subtitle')}
        </p>
        <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-3">
          {trustPillars.map(({ key, icon: Icon }) => (
            <div key={key}>
              <Icon className="text-primary" size={24} aria-hidden="true" />
              <h3 className="mt-5 font-heading text-lg font-bold text-foreground">
                {t(`${key}.title`)}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground md:text-lg">
                {t(`${key}.desc`)}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-3xl text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('tagline')}
        </p>
      </div>
    </section>
  )
}
