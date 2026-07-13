import { BadgeCheck, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SurfaceCard } from '@/components/ui/card'

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
    <section className="bg-secondary py-12 md:py-16">
      <div className="page-gutter mx-auto max-w-6xl">
        <p className="type-eyebrow-cta">{t('tagline')}</p>
        <h2 className="mt-4 type-page-title-large text-balance">{t('heading')}</h2>
        <p className="mt-4 max-w-2xl type-body-muted text-pretty">{t('subtitle')}</p>
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {trustPillars.map(({ key, icon: Icon }) => (
            <SurfaceCard key={key} tone="background" padding="lg" className="h-full">
              <Icon className="text-cta" size={24} aria-hidden="true" />
              <h3 className="mt-5 type-card-title">
                {t(`${key}.title`)}
              </h3>
              <p className="mt-3 type-body-muted text-pretty">
                {t(`${key}.desc`)}
              </p>
            </SurfaceCard>
          ))}
        </div>
      </div>
    </section>
  )
}
