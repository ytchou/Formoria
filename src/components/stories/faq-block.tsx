import { useLocale } from 'next-intl'
import { surfaceCardStyles } from '@/components/ui/card'
import { buildFaqPageJsonLd, safeJsonLdStringify } from '@/lib/json-ld'

type FaqItem = {
  q: string
  a: string
}

type FaqBlockProps = {
  questions?: FaqItem[] | null
}

export function FaqBlock({ questions }: FaqBlockProps) {
  const locale = useLocale()
  const items = questions ?? []
  if (items.length === 0) return null

  const faqJsonLd = buildFaqPageJsonLd(items, locale)

  return (
    <section className="space-y-4">
      {faqJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(faqJsonLd) }}
        />
      ) : null}
      {items.map((item) => (
        <details key={item.q} className={surfaceCardStyles({ className: 'px-4 py-3', padding: 'none' })}>
          <summary className="cursor-pointer type-card-title">
            {item.q}
          </summary>
          <div className="mt-3 type-body-muted">
            {item.a}
          </div>
        </details>
      ))}
    </section>
  )
}
