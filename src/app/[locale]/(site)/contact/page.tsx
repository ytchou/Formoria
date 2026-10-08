import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Building2, HelpCircle, Mail } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { CopyTextButton } from '@/components/shared/copy-text-button'
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
    { key: 'brand', icon: Building2, href: routes.brands(), external: false },
    { key: 'question', icon: HelpCircle, href: routes.faq(), external: false },
  ] as const

  const ctaClassName = buttonVariants({
    variant: 'secondary',
    size: 'large',
    className: 'w-fit',
  })

  return (
    <PageShell as="main" measure="page" className="py-10">
      <section className="border-b border-rule pb-10">
        <div className="prose-measure">
          <p className="type-eyebrow">{t('hero.eyebrow')}</p>
          <h1 className="mt-3 type-display">{t('hero.title')}</h1>
          <p className="mt-4 type-body">{t('hero.intro')}</p>
        </div>
      </section>

      <section className="py-10">
        {/* Three columns only from lg: at md each card was ~218px, so the
            body wrapped every eight or nine characters. */}
        <div className="grid gap-4 lg:grid-cols-3">
          {channels.map(({ key, icon: Icon, href, external }) => (
            <article
              key={key}
              className={surfaceCardStyles({ className: 'flex flex-col' })}
            >
              <Icon aria-hidden="true" className="size-5 text-ink-soft" />
              <h2 className="mt-4 type-card-title">
                {t(`channels.${key}.title`)}
              </h2>
              <p className="mt-2 type-body-sm">
                {t(`channels.${key}.body`)}
              </p>
              {/* `mt-auto` pins the CTA to the card's foot so the three
                  buttons line up whatever each body's length. The address
                  therefore sits ABOVE the mail button, not below it: below,
                  it would lift that one button out of line with the others. */}
              <div className="mt-auto pt-5">
                {external ? (
                  <>
                    {/* The address in plain sight: a mailto link does
                        nothing for a reader with no mail client set up. */}
                    {/* Stacked, with the ghost button pulled out by its own
                        inline padding so its label shares the address's
                        left edge. */}
                    <div className="mb-3 flex flex-col items-start">
                      <span className="select-all break-all type-body-sm text-ink">
                        {CONTACT_EMAILS.contact}
                      </span>
                      <CopyTextButton
                        text={CONTACT_EMAILS.contact}
                        label={t(`channels.${key}.copy`)}
                        copiedLabel={t(`channels.${key}.copied`)}
                        className="-ml-3"
                      />
                    </div>
                    <a href={href} className={ctaClassName}>
                      {t(`channels.${key}.cta`)}
                    </a>
                  </>
                ) : (
                  <Link href={href} className={ctaClassName}>
                    {t(`channels.${key}.cta`)}
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </PageShell>
  )
}
