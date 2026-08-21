import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Building2, HelpCircle, Lightbulb, Mail } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import { surfaceCardStyles } from '@/components/ui/card'
import { PageShell } from '@/components/ui/page-shell'
import { CONTACT_EMAILS } from '@/lib/constants'
import { buildAlternates } from '@/lib/seo/alternates'
import type { Locale } from '@/lib/seo/alternates'
import { buildOpenGraph } from '@/lib/seo/open-graph'
import { routes } from '@/lib/routes'

export const revalidate = 86400

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  setRequestLocale(locale)
  const safeLocale = (locale === 'en' ? 'en' : 'zh-TW') as Locale
  const t = await getTranslations('contact.metadata')
  const title = t('title')
  const description = t('description')
  const { canonical, languages } = buildAlternates(routes.contact(), safeLocale)
  const ogLocale = safeLocale === 'en' ? 'en_US' : 'zh_TW'
  const ogAlternateLocale = safeLocale === 'en' ? 'zh_TW' : 'en_US'

  return {
    title,
    description,
    alternates: { canonical, languages },
    ...buildOpenGraph({
      title,
      description,
      url: canonical,
      locale: ogLocale,
      alternateLocale: [ogAlternateLocale],
    }),
  }
}

export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('contact')

  // `external` marks the one channel that leaves the app (mailto:) and so needs
  // a plain anchor rather than the locale-aware Link.
  const channels = [
    {
      key: 'problem',
      icon: Mail,
      href: `mailto:${CONTACT_EMAILS.contact}`,
      external: true,
    },
    {
      key: 'feature',
      icon: Lightbulb,
      href: routes.featureRequests(),
      external: false,
    },
    { key: 'brand', icon: Building2, href: routes.brands(), external: false },
    { key: 'question', icon: HelpCircle, href: routes.faq(), external: false },
  ] as const

  const ctaClassName = buttonVariants({
    variant: 'secondary',
    size: 'large',
    className: 'mt-5 w-fit',
  })

  return (
    <PageShell as="main" measure="page" className="py-10">
      <section className="border-b border-border pb-10">
        <div className="prose-measure">
          <p className="type-eyebrow">{t('hero.eyebrow')}</p>
          <h1 className="mt-3 type-display">{t('hero.title')}</h1>
          <p className="mt-4 type-body">{t('hero.intro')}</p>
        </div>
      </section>

      <section className="py-10">
        <div className="grid gap-4 md:grid-cols-2">
          {channels.map(({ key, icon: Icon, href, external }) => (
            <article key={key} className={surfaceCardStyles()}>
              <div className="flex size-8 items-center justify-center rounded-full bg-accent text-ground">
                <Icon aria-hidden="true" className="size-4" />
              </div>
              <h2 className="mt-4 type-card-title">
                {t(`channels.${key}.title`)}
              </h2>
              <p className="mt-2 type-body-sm">
                {t(`channels.${key}.body`)}
              </p>
              {external ? (
                <a href={href} className={ctaClassName}>
                  {t(`channels.${key}.cta`)}
                </a>
              ) : (
                <Link href={href} className={ctaClassName}>
                  {t(`channels.${key}.cta`)}
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>
    </PageShell>
  )
}
