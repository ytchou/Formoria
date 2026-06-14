import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { CONTACT_EMAILS } from '@/lib/constants'

export function Footer() {
  const t = useTranslations('footer')

  return (
    <footer
      role="contentinfo"
      className="border-t border-border bg-white"
    >
      <div className="mx-auto max-w-screen-xl px-6 py-12 md:px-10">
        {/* Multi-column link grid */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {/* Discover */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {t('discoverHeading')}
            </p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/brands"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('directory')}
                </Link>
              </li>
              <li>
                <Link
                  href="/categories"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('categories')}
                </Link>
              </li>
              <li>
                <Link
                  href="/getting-started"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('gettingStarted')}
                </Link>
              </li>
              <li>
                <Link
                  href="/submit"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('submit')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {t('companyHeading')}
            </p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/about"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('about')}
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('faq')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {t('legalHeading')}
            </p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/terms"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('terms')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Connect */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {t('connectHeading')}
            </p>
            <ul className="mt-4 space-y-2">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAILS.contact}`}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('contact')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar: tagline + copyright */}
        <div className="mt-10 flex flex-col items-start gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{t('tagline')}</p>
          <p className="text-xs text-muted-foreground">
            {t('copyright', { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  )
}
