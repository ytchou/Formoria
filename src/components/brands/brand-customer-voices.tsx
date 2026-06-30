import { getTranslations } from 'next-intl/server'
import type { Brand } from '@/lib/types'

interface BrandCustomerVoicesProps {
  brand: Brand
}

export async function BrandCustomerVoices({ brand }: BrandCustomerVoicesProps) {
  if (brand.customerVoices?.length === 0) return null
  const t = await getTranslations('brandDetail')

  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">{t('sections.customerVoices')}</h2>
      <div className="space-y-4">
        {brand.customerVoices.slice(0, 5).map((voice, i) => (
          <blockquote key={i} className="rounded-lg border border-border bg-secondary/50 px-4 py-3">
            <p className="text-sm leading-relaxed text-muted-foreground italic">&ldquo;{voice.content}&rdquo;</p>
            <footer className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{voice.author}</span>
              {voice.source && (
                <>
                  <span>&middot;</span>
                  <span>{voice.source}</span>
                </>
              )}
            </footer>
          </blockquote>
        ))}
      </div>
    </section>
  )
}
