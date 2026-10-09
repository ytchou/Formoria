'use client'

import type { FormEvent } from 'react'
import { Globe } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { setLocalePreference } from '@/app/actions/locale-preference'
import { Button } from '@/components/ui/button'
import { UnstyledButton } from '@/components/ui/unstyled-button'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePathname } from '@/i18n/navigation'
import { LOCALE_COOKIE, readOnlyStagingLocaleHref, type AppLocale } from '@/i18n/locale-preference'
import { trackLanguageSwitched } from '@/lib/analytics'

function preserveCurrentUrl(event: FormEvent<HTMLFormElement>, locale: AppLocale) {
  const returnTo = event.currentTarget.elements.namedItem('returnTo')
  if (returnTo instanceof HTMLInputElement) {
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    returnTo.value = currentUrl

    const stagingHref = readOnlyStagingLocaleHref(
      currentUrl,
      locale,
      process.env.NEXT_PUBLIC_DEPLOYMENT_ENV,
    )
    if (stagingHref) {
      event.preventDefault()
      /*
       * The staging bypass never reaches `setLocalePreference`, which is the
       * only writer of the locale cookie. Without this the choice is lost on
       * the next request and next-intl falls back to the default locale.
       * Attributes mirror the server action, which sets httpOnly: false --
       * so the client can write the same cookie the server would have.
       */
      document.cookie = [
        `${LOCALE_COOKIE}=${locale}`,
        'path=/',
        'samesite=lax',
        `max-age=${365 * 24 * 60 * 60}`,
        ...(window.location.protocol === 'https:' ? ['secure'] : []),
      ].join(';')
      window.location.assign(stagingHref)
    }
  }
}

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('nav')
  const location = compact ? 'mobile_menu' : 'header'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={compact ? undefined : t('languageLabel')}
        render={
          <Button
            variant="ghost"
            // Both branches were hand-sized below the 44px floor (min-h-9 /
            // size-9). The size axis restores it; the colour classes stay
            // because this trigger reads as chrome, not as an accent action.
            size={compact ? 'compact' : 'icon'}
            className="text-ink-muted hover:bg-surface hover:text-ink"
          />
        }
      >
        {compact ? t(locale === 'zh-TW' ? 'languageTraditionalChinese' : 'languageEnglish') : <Globe className="size-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 min-w-36">
        {/* A radio group, so the current language is exposed as
            `menuitemradio` + `aria-checked` rather than by weight alone, and
            `size="touch"` holds each item at the 44px floor (SP2-19). Each item
            still submits its own form: the radio state is display-only. */}
        <DropdownMenuRadioGroup value={locale}>
          {(['zh-TW', 'en'] as const).map((targetLocale) => (
            <form
              key={targetLocale}
              action={setLocalePreference.bind(null, targetLocale)}
              onSubmit={(event) => preserveCurrentUrl(event, targetLocale)}
            >
              <input type="hidden" name="returnTo" defaultValue={pathname} />
              <DropdownMenuRadioItem
                value={targetLocale}
                size="touch"
                closeOnClick
                className={locale === targetLocale ? 'font-medium' : undefined}
                render={
                  <UnstyledButton
                    type="submit"
                    className="w-full text-left"
                    data-ph-no-autocapture
                    onClick={() => trackLanguageSwitched(locale, targetLocale, location)}
                  />
                }
              >
                {t(targetLocale === 'zh-TW' ? 'languageTraditionalChinese' : 'languageEnglish')}
              </DropdownMenuRadioItem>
            </form>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
