import { useLocale } from 'next-intl'
import { surfaceCardStyles } from '@/components/ui/card'
import { buildFaqPageJsonLd, safeJsonLdStringify } from '@/lib/json-ld'

type FaqItem = {
  q: string
  a: string
}

type FaqBlockProps = {
  questions?: FaqItem[] | null
  /**
   * Emit the FAQPage structured data alongside the accordion. Defaults to true
   * for the frontmatter-driven block the detail page renders once per story.
   *
   * The MDX `<FaqBlock>` shortcode passes `false`: a story may drop several of
   * them mid-body, and every one would emit its own competing FAQPage node on a
   * page that already carries one. The visible accordion is identical either way.
   */
  emitJsonLd?: boolean
}

export function FaqBlock({ questions, emitJsonLd = true }: FaqBlockProps) {
  const locale = useLocale()
  const items = questions ?? []
  if (items.length === 0) return null

  const faqJsonLd = emitJsonLd ? buildFaqPageJsonLd(items, locale) : null

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
