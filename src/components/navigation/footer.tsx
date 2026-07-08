import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { CONTACT_EMAILS, FEEDBACK_FORM_URL } from '@/lib/constants'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'

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
            <p className="type-eyebrow-foreground">
              {t('discoverHeading')}
            </p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/brands"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('directory')}
                </Link>
              </li>
              <li>
                <Link
                  href="/getting-started"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('gettingStarted')}
                </Link>
              </li>
              <li>
                <Link
                  href="/guides"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('guides')}
                </Link>
              </li>
              <li>
                <Link
                  href="/submit"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('submit')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <p className="type-eyebrow-foreground">
              {t('companyHeading')}
            </p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/about"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('about')}
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('faq')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="type-eyebrow-foreground">
              {t('legalHeading')}
            </p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link
                  href="/terms"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('terms')}
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('privacy')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Connect */}
          <div>
            <p className="type-eyebrow-foreground">
              {t('connectHeading')}
            </p>
            <ul className="mt-4 space-y-2">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAILS.contact}`}
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('contact')}
                </a>
              </li>
              <li>
                <a
                  href={FEEDBACK_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="type-card-description hover:text-foreground transition-colors"
                >
                  {t('feedback')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar: tagline + copyright */}
        <div className="mt-10 flex flex-col items-start gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="type-card-description">{t('tagline')}</p>
          <div className="flex items-center gap-3">
            <LocaleSwitcher compact />
            <p className="type-caption">
              {t('copyright', { year: new Date().getFullYear() })}
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
