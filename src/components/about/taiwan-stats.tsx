import { PageShell } from '@/components/ui/page-shell'

import {
  AboutCard,
  AboutCardContent,
  AboutCardGrid,
} from './about-card-grid'

interface TaiwanStatItem {
  value: string
  label: string
}

interface TaiwanStatsProps {
  heading: string
  intro: string
  items: [TaiwanStatItem, TaiwanStatItem, TaiwanStatItem]
  sourceLabel: string
  sourceName: string
}

export default function TaiwanStats({
  heading,
  intro,
  items,
  sourceLabel,
  sourceName,
}: TaiwanStatsProps) {
  return (
    <section className="py-section">
      <PageShell measure="page">
        <div>
          <h2 className="type-page-title text-balance">{heading}</h2>
          <p className="mt-4 prose-measure type-body text-pretty">{intro}</p>
        </div>
        <AboutCardGrid>
          {items.map((item) => (
            <AboutCard key={item.label}>
              <AboutCardContent eyebrow={item.value} heading={item.label} />
            </AboutCard>
          ))}
        </AboutCardGrid>
        <p className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 type-metadata">
          <span className="type-eyebrow">{sourceLabel}</span>
          <a
            href="https://www.sme.gov.tw/article-tw-2853-13097"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            {sourceName}
          </a>
        </p>
      </PageShell>
    </section>
  )
}
