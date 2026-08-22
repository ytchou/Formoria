import { useLocale } from 'next-intl'
import { Accordion, AccordionItem } from '@/components/ui/accordion'
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
    <section>
      {faqJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(faqJsonLd) }}
        />
      ) : null}
      <Accordion>
        {items.map((item) => (
          <AccordionItem key={item.q} title={item.q}>
            {item.a}
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
