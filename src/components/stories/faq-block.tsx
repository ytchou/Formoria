type FaqItem = {
  q: string
  a: string
}

type FaqBlockProps = {
  questions?: FaqItem[] | null
  /** The content's language when it differs from the page's (see `contentLangFor`). */
  lang?: string
}

/**
 * The story FAQ as an open definition list, never a collapsed panel: an answer
 * to a question ships visible in the server HTML (DESIGN.md §7). Same markup as
 * `BrandFaqAccordion`, minus its heading — the `stories` namespace has no FAQ
 * heading key.
 */
export function FaqBlock({ questions, lang }: FaqBlockProps) {
  const items = questions ?? []
  if (items.length === 0) return null

  return (
    <section lang={lang}>
      <dl className="space-y-stack">
        {items.map((item) => (
          <div key={item.q}>
            <dt className="type-body font-semibold text-ink">{item.q}</dt>
            <dd className="mt-2 type-body">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
