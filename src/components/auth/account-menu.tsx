'use client'

import NextLink from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import type { AppLocale } from '@/i18n/locale-preference'

import { signOut } from '@/app/auth/actions'
import { setLocalePreference } from '@/app/actions/locale-preference'
import { useUser } from '@/lib/auth/use-user'
import { FEEDBACK_FORM_URL } from '@/lib/constants'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function getUserInitial(email?: string | null): string {
  const initial = email?.trim().charAt(0).toUpperCase()

  return initial || '?'
}

export function AccountMenu() {
  const { user, loading } = useUser()
  const t = useTranslations()
  const locale = useLocale()
  const pathname = usePathname()

  if (loading) {
    return <div data-account-menu-placeholder className="h-9 w-12" aria-hidden />
  }

  if (!user) {
    return (
      <NextLink
        href={`/auth/sign-in?next=${encodeURIComponent(localizePath(pathname, locale as AppLocale))}`}
        className="inline-flex h-9 items-center justify-center rounded-md px-2.5 type-metadata transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {t('nav.signIn')}
      </NextLink>
    )
  }

  const initial = getUserInitial(user.email)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('account.menuLabel')}
        className="inline-flex size-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 min-w-40">
        <DropdownMenuItem
          render={<Link href="/settings" />}
        >
          {t('account.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link href="/favorites" />}
        >
          {t('account.favorites')}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer" />}
        >
          {t('account.feedback')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(['zh-TW', 'en'] as const).map((targetLocale) => (
          <form key={targetLocale} action={setLocalePreference.bind(null, targetLocale, pathname)}>
            <DropdownMenuItem
              className={locale === targetLocale ? 'font-medium' : undefined}
              render={<button type="submit" className="w-full text-left" aria-current={locale === targetLocale ? 'true' : undefined} />}
            >
              {t(targetLocale === 'zh-TW'
                ? 'nav.languageTraditionalChinese'
                : 'nav.languageEnglish')}
            </DropdownMenuItem>
          </form>
        ))}
        <DropdownMenuSeparator />
        <form action={signOut.bind(null, localizePath(pathname, locale as AppLocale))}>
          <DropdownMenuItem
            variant="destructive"
            render={<button type="submit" className="w-full text-left" />}
          >
            {t('account.signOut')}
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
