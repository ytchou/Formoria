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
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {eyebrow}
        </p>
        <h2 className="mt-4 font-heading text-3xl font-bold leading-tight text-foreground md:text-4xl">
          {heading}
        </h2>
        <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground md:text-lg">
          {intro}
        </p>
        <dl className="mt-12 grid gap-10 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.label} className="border-t border-border pt-4">
              <dd className="font-heading text-5xl font-bold leading-none text-primary md:text-6xl">
                {item.value}
              </dd>
              <dt className="mt-3 text-base font-semibold text-foreground">
                {item.label}
              </dt>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </dl>
        <p className="mt-12 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-6 text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">{sourceLabel}</span>
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
