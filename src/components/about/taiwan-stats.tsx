import { SurfaceCard } from '@/components/ui/card'

interface TaiwanStatItem {
  value: string
  label: string
  detail: string
}

interface TaiwanStatsProps {
  eyebrow: string
  heading: string
  intro: string
  items: [TaiwanStatItem, TaiwanStatItem, TaiwanStatItem]
  sourceLabel: string
  sourceName: string
}

export default function TaiwanStats({
  eyebrow,
  heading,
  intro,
  items,
  sourceLabel,
  sourceName,
}: TaiwanStatsProps) {
  return (
    <section className="bg-secondary py-12 md:py-16">
      <div className="page-gutter mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <p className="type-eyebrow-muted">{eyebrow}</p>
          <h2 className="mt-4 type-page-title-large text-balance">{heading}</h2>
          <p className="mt-4 max-w-prose type-body-muted text-pretty">{intro}</p>
        </div>
        <dl className="mt-8 grid gap-4 sm:grid-cols-3">
          {items.map((item) => (
            <SurfaceCard key={item.label} tone="background" padding="lg" className="h-full">
              <div className="flex flex-col-reverse">
                <dt className="mt-3 type-card-title">
                  {item.label}
                </dt>
                <dd className="type-stat-large tabular-nums">
                  {item.value}
                </dd>
              </div>
              <p className="mt-1 type-card-description">{item.detail}</p>
            </SurfaceCard>
          ))}
        </dl>
        <p className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 type-caption">
          <span className="type-eyebrow-muted">{sourceLabel}</span>
          <a
            href="https://www.sme.gov.tw/article-tw-2853-13097"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            {sourceName}
          </a>
        </p>
      </div>
    </section>
  )
}
