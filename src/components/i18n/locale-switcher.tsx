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
        render={
          <Button
            variant="ghost"
            // Both branches were hand-sized below the 44px floor (min-h-9 /
            // size-9). The size axis restores it; the colour classes stay
            // because this trigger reads as chrome, not as an accent action.
            size={compact ? 'compact' : 'icon'}
            className="text-muted-foreground hover:bg-muted hover:text-foreground"
          />
        }
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
                <UnstyledButton
                  type="submit"
                  className="w-full text-left"
                  aria-current={locale === targetLocale ? 'true' : undefined}
                  data-ph-no-autocapture
                  onClick={() => trackLanguageSwitched(locale, targetLocale, location)}
                />
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
