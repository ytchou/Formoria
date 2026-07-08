import { buildFaqPageJsonLd, safeJsonLdStringify } from '@/lib/json-ld'

type FaqItem = {
  q: string
  a: string
}

type FaqBlockProps = {
  questions?: FaqItem[] | null
}

export function FaqBlock({ questions }: FaqBlockProps) {
  const items = questions ?? []
  if (items.length === 0) return null

  const jsonLd = buildFaqPageJsonLd(
    items.map((question) => ({
      question: question.q,
      answer: question.a,
    })),
  )

  return (
    <section className="space-y-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      {items.map((item) => (
        <details key={item.q} className="rounded-xl border border-border bg-card px-4 py-3">
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
