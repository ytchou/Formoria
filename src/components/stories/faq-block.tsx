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
          {/*
            Native `<details>`, never a scripted accordion: the answer ships in
            the server HTML either way, which is what makes it readable by a
            crawler that never opens the panel. `summary` is focusable by
            default, so the only thing it needs from us is a visible ring.

            Padding, never `flex`: `display:flex` suppresses the ::marker, and
            the disclosure triangle is the only affordance saying this opens.
            `py-2` on a 28px line is the 44px target.
          */}
          <summary className="cursor-pointer rounded-[2px] py-2 type-card-title focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground">
            {item.q}
          </summary>
          <div className="mt-3 type-body-sm text-ink-soft">
            {item.a}
          </div>
        </details>
      ))}
    </section>
  )
}
