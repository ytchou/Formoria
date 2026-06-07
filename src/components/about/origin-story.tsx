import { useTranslations } from 'next-intl'

export default function OriginStory() {
  const t = useTranslations('about')

  return (
    <section className="py-12 md:py-16">
      <div className="max-w-2xl text-left">
        <blockquote className="font-heading text-2xl text-primary md:text-3xl">
          {t('origin.quote')}
        </blockquote>
        <div className="mt-8 space-y-4 text-sm leading-[1.8] text-foreground">
          <p>{t('origin.body1')}</p>
          <p>{t('origin.body2')}</p>
          <p>{t('origin.body3')}</p>
        </div>
      </div>
    </section>
  )
}
