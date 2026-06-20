import { getTranslations } from 'next-intl/server'
import type { Brand } from '@/lib/types'

interface BrandAboutProps {
  brand: Brand
}

export async function BrandAbout({ brand }: BrandAboutProps) {
  if (!brand.description) return null

  const t = await getTranslations('brandDetail')
  const paragraphs = brand.description.split('\n\n')

  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        {t('sections.about')}
      </h2>
      <div className="space-y-3">
        {paragraphs.map((paragraph, i) => (
          <p
            key={i}
            className="text-sm leading-relaxed text-muted-foreground"
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
