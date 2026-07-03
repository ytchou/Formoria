import { buildFaqPageJsonLd, safeJsonLdStringify } from '@/lib/json-ld'

type FaqItem = {
  q: string
  a: string
}

type FaqBlockProps = {
  questions?: FaqItem[]
}

export function FaqBlock({ questions = [] }: FaqBlockProps) {
  if (questions.length === 0) return null

  const jsonLd = buildFaqPageJsonLd(
    questions.map((question) => ({
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
      {questions.map((item) => (
        <details key={item.q} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-base font-semibold text-stone-900">
            {item.q}
          </summary>
          <div className="mt-3 text-base leading-7 text-stone-700">
            {item.a}
          </div>
        </details>
      ))}
    </section>
  )
}
