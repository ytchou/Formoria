'use client'

import type { FormEvent } from 'react'
import NextLink from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { signInHref } from '@/i18n/locale-preference'

import { setLocalePreference } from '@/app/actions/locale-preference'
import { useUser } from '@/lib/auth/use-user'
import { trackSignOut } from '@/lib/analytics'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function handleSignOut() {
  trackSignOut()
}

function preserveCurrentUrl(event: FormEvent<HTMLFormElement>) {
  const returnTo = event.currentTarget.elements.namedItem('returnTo')
  if (returnTo instanceof HTMLInputElement) {
    returnTo.value = `${window.location.pathname}${window.location.search}${window.location.hash}`
  }
}

function getUserInitial(email?: string | null): string {
  const initial = email?.trim().charAt(0).toUpperCase()

  return initial || '?'
}

export function AccountMenu() {
  const { user, loading, viewer } = useUser()
  const t = useTranslations()
  const locale = useLocale()
  const pathname = usePathname()

  if (loading) {
    return <div data-account-menu-placeholder className="h-9 w-12" aria-hidden />
  }

  if (!user) {
    return (
      <NextLink
        href={signInHref(pathname, locale)}
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
        className="inline-flex size-9 items-center justify-center rounded-full bg-secondary type-subsection-title text-secondary-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
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
          render={<Link href="/contributions" />}
        >
          {t('account.contributions')}
        </DropdownMenuItem>
        {viewer.ownerFeaturesEnabled ? (
          <DropdownMenuItem
            render={<Link href="/my-submissions" />}
          >
            {t('account.mySubmissions')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          render={<Link href="/feature-requests" />}
        >
          {t('account.feedback')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(['zh-TW', 'en'] as const).map((targetLocale) => (
          <form
            key={targetLocale}
            action={setLocalePreference.bind(null, targetLocale)}
            onSubmit={preserveCurrentUrl}
          >
            <input type="hidden" name="returnTo" defaultValue={pathname} />
            <DropdownMenuItem
              className={locale === targetLocale ? 'font-medium' : undefined}
              render={
                /* eslint-disable no-restricted-syntax -- ui-exception: render-prop injection for DropdownMenuItem, raw button is required by Base UI render prop API */
                <button type="submit" className="w-full text-left" aria-current={locale === targetLocale ? 'true' : undefined} />
                /* eslint-enable no-restricted-syntax */
              }
            >
              {t(targetLocale === 'zh-TW'
                ? 'nav.languageTraditionalChinese'
                : 'nav.languageEnglish')}
            </DropdownMenuItem>
          </form>
        ))}
        <DropdownMenuSeparator />
        <form action="/auth/sign-out" method="post" onSubmit={preserveCurrentUrl}>
          <input type="hidden" name="returnTo" defaultValue={pathname} />
          <DropdownMenuItem
            variant="destructive"
            render={
              /* eslint-disable no-restricted-syntax -- ui-exception: render-prop injection for DropdownMenuItem, raw button is required by Base UI render prop API */
              <button type="submit" className="w-full text-left" onClick={handleSignOut} />
              /* eslint-enable no-restricted-syntax */
            }
          >
            {t('account.signOut')}
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
