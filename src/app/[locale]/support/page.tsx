import type { Metadata } from 'next'
import Script from 'next/script'
import { getTranslations, setRequestLocale } from 'next-intl/server'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.support.metadata')
  return {
    title: t('title'),
    description: t('description'),
  }
}

export default async function SupportPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.support')

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <div className="space-y-16">
        {/* Hero */}
        <section className="space-y-4">
          <h1 className="font-heading text-[26px] font-bold text-foreground">{t('title')}</h1>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('intro1')}
          </p>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('intro2')}
          </p>
        </section>

        {/* Buy Me a Coffee */}
        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">{t('coffee.heading')}</h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7]">
            {t('coffee.body')}
          </p>
          <a
            href="https://buymeacoffee.com/ytchou"
            target="_blank"
            rel="noopener noreferrer"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
              alt="Buy Me A Coffee"
              width={217}
              height={60}
            />
          </a>
        </section>

        {/* How it helps */}
        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">{t('usage.heading')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-foreground">
                {t('usage.server.heading')}
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                {t('usage.server.body')}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-foreground">
                {t('usage.development.heading')}
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                {t('usage.development.body')}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <h3 className="font-heading text-base font-bold text-foreground">
                {t('usage.community.heading')}
              </h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                {t('usage.community.body')}
              </p>
            </div>
          </div>
        </section>
      </div>

      <Script
        src="https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js"
        data-name="BMC-Widget"
        data-id="ytchou"
        data-description={t('widgetDescription')}
        data-color="#40DCA5"
        data-position="Right"
        data-x_margin="18"
        data-y_margin="18"
        strategy="lazyOnload"
      />
    </main>
  )
}
