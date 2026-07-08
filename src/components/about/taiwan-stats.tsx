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
    <section className="bg-secondary">
      <div className="mx-auto max-w-5xl px-6 py-16 md:px-8 md:py-24">
        <p className="type-eyebrow-muted">
          {eyebrow}
        </p>
        <h2 className="mt-4 type-page-title-large">
          {heading}
        </h2>
        <p className="mt-4 max-w-prose type-body-muted">
          {intro}
        </p>
        <dl className="mt-12 grid gap-10 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.label} className="border-t border-border pt-4">
              <dd className="type-stat-large">
                {item.value}
              </dd>
              <dt className="mt-3 type-card-title">
                {item.label}
              </dt>
              <p className="mt-1 type-card-description">{item.detail}</p>
            </div>
          ))}
        </dl>
        <p className="mt-12 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-6 type-caption">
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
