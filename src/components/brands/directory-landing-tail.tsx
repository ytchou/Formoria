import { ChevronDown } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/lib/seo/alternates'
import { FaqSection } from '@/components/shared/faq-section'
import { readDirectoryLandingCopy } from './directory-landing-head'

type DirectoryLandingTailProps = {
  locale: Locale
  category: { slug: string; label: string } | null
  subcategory: { slug: string; label: string } | null
}

export async function DirectoryLandingTail({
  category,
  locale,
  subcategory,
}: DirectoryLandingTailProps) {
  const categoryT = await getTranslations({ locale, namespace: 'categories' })
  const copy = readDirectoryLandingCopy(
    categoryT,
    category?.slug,
    subcategory?.slug,
  )
  if (!copy || (copy.faq.length === 0 && !copy.definition)) return null

  return (
    <div className="mt-16 border-t border-border pt-10">
      {copy.faq.length > 0 ? (
        <FaqSection title={categoryT('landing.faqTitle')}>
          <div className="divide-y divide-border">
            {copy.faq.map((item, index) => (
              <details key={`${item.question}-${index}`} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between py-5 type-faq-question focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDown className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </summary>
                <p className="pb-5 type-body-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </FaqSection>
      ) : null}
      {copy.definition ? (
        <section className={copy.faq.length > 0 ? 'mt-10' : undefined}>
          <h2 className="type-section-title-large">
            {categoryT('landing.definitionTitle')}
          </h2>
          <p className="mt-3 max-w-[48rem] type-body-muted">{copy.definition}</p>
        </section>
      ) : null}
    </div>
  )
}
