import { useTranslations } from 'next-intl'

interface StatsBarProps {
  brandCount: number
  categoryCount: number
  brandUnit: string
  categoryUnit: string
}

export default function StatsBar({ brandCount, categoryCount, brandUnit, categoryUnit }: StatsBarProps) {
  const t = useTranslations('about.stats')

  const stats = [
    { value: brandCount, label: brandUnit },
    { value: categoryCount, label: categoryUnit },
    { value: t('curatedValue'), label: t('curatedLabel') },
  ]

  return (
    <section className="bg-background py-10 text-center">
      <div className="flex justify-center gap-12 md:gap-16">
        {stats.map((stat) => (
          <div key={stat.label}>
            <div className="font-heading text-3xl font-bold text-cta">{stat.value}</div>
            <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
