'use client'

import type { FormEvent } from 'react'
import { Globe } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { setLocalePreference } from '@/app/actions/locale-preference'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePathname } from '@/i18n/navigation'
import { readOnlyStagingLocaleHref, type AppLocale } from '@/i18n/locale-preference'
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
        className={compact
          ? 'inline-flex min-h-9 items-center justify-center rounded-lg px-2 type-caption transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50'
          : 'inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50'}
      >
        {compact ? t(locale === 'zh-TW' ? 'languageTraditionalChinese' : 'languageEnglish') : <Globe className="size-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 min-w-36">
        {(['zh-TW', 'en'] as const).map((targetLocale) => (
          <form
            key={targetLocale}
            action={setLocalePreference.bind(null, targetLocale)}
            onSubmit={(event) => preserveCurrentUrl(event, targetLocale)}
          >
            <input type="hidden" name="returnTo" defaultValue={pathname} />
            <DropdownMenuItem
              className={locale === targetLocale ? 'font-medium' : undefined}
              render={
                /* eslint-disable no-restricted-syntax -- ui-exception: render-prop injection for DropdownMenuItem, raw button is required by Base UI render prop API */
                <button
                  type="submit"
                  className="w-full text-left"
                  aria-current={locale === targetLocale ? 'true' : undefined}
                  data-ph-no-autocapture
                  onClick={() => trackLanguageSwitched(locale, targetLocale, location)}
                />
                /* eslint-enable no-restricted-syntax */
              }
            >
              {t(targetLocale === 'zh-TW' ? 'languageTraditionalChinese' : 'languageEnglish')}
            </DropdownMenuItem>
          </form>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
