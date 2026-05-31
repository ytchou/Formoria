import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.terms.metadata')
  return {
    title: t('title'),
    description: t('description'),
  }
}

export default async function TermsPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('legal.terms')

  return (
    <main className="mx-auto w-full max-w-screen-xl px-6 py-10 md:px-10">
      <div className="space-y-16">
        <section className="space-y-4">
          <h1 className="font-heading text-[26px] font-bold text-foreground">{t('title')}</h1>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('intro')}
          </p>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('lastUpdated')}
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            {t('contentOwnership.heading')}
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('contentOwnership.body')}
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            {t('dataUse.heading')}
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('dataUse.body')}
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            {t('reviewProcess.heading')}
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('reviewProcess.body')}
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            {t('disclaimer.heading')}
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('disclaimer.body')}
          </p>
        </section>

        <section className="space-y-4 border-t border-border pt-12">
          <h2 className="font-heading text-xl font-bold text-foreground">
            {t('changes.heading')}
          </h2>
          <p className="font-sans text-sm text-muted-foreground leading-[1.7] max-w-2xl">
            {t('changes.body')}
          </p>
        </section>
      </div>
    </main>
  )
}
