import { getTranslations, getLocale } from 'next-intl/server'
import type { Brand } from '@/lib/types'

interface BrandAboutProps {
  brand: Brand
}

export async function BrandAbout({ brand }: BrandAboutProps) {
  const locale = await getLocale()
  const description = locale === 'en'
    ? (brand.descriptionEn ?? brand.description)
    : brand.description

  if (!description) return null

  const t = await getTranslations('brandDetail')
  const paragraphs = description.split('\n\n')

  return (
    <section>
      <h2 className="mb-3 type-section-title">
        {t('sections.about')}
      </h2>
      <div className="space-y-3">
        {paragraphs.map((paragraph, i) => (
          <p
            key={i}
            className="type-section-description"
          >
            {paragraph.split('\n').map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ))}
      </div>
    </section>
  )
}
