'use client'

import type { FormEvent } from 'react'
import NextLink from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import {
  readOnlyStagingLocaleHref,
  signInHref,
  type AppLocale,
} from '@/i18n/locale-preference'

import { setLocalePreference } from '@/app/actions/locale-preference'
import { Button } from '@/components/ui/button'
import { UnstyledButton } from '@/components/ui/unstyled-button'
import { useUser } from '@/lib/auth/use-user'
import { trackSignOut } from '@/lib/analytics'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { routes } from '@/lib/routes'

function handleSignOut() {
  trackSignOut()
}

function preserveCurrentUrl(event: FormEvent<HTMLFormElement>, locale?: AppLocale) {
  const returnTo = event.currentTarget.elements.namedItem('returnTo')
  if (returnTo instanceof HTMLInputElement) {
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    returnTo.value = currentUrl

    const stagingHref = locale
      ? readOnlyStagingLocaleHref(
          currentUrl,
          locale,
          process.env.NEXT_PUBLIC_DEPLOYMENT_ENV,
        )
      : null
    if (stagingHref) {
      event.preventDefault()
      window.location.assign(stagingHref)
    }
  }
}

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
        href={signInHref(pathname, locale)}
        className="inline-flex h-9 items-center justify-center rounded-control px-2.5 type-metadata transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-accent/50 focus-visible:outline-none"
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
        render={<Button variant="ghost" size="icon" shape="pill" />}
      >
        {/*
          The TAP TARGET is the 44x44 Button; the painted disc stays 36px so the
          header is visually unchanged. Same split as `save-brand-button.tsx` —
          sizing the disc itself to 44px would enlarge the chrome, and shrinking
          the target to 36px would break the touch floor (DESIGN.md:293).
        */}
        <span className="flex size-9 items-center justify-center rounded-full bg-surface type-body-sm font-semibold text-ink-soft transition-colors group-hover/button:bg-surface-deep">
          {initial}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 min-w-40">
        <DropdownMenuItem
          render={<Link href={routes.settings()} />}
        >
          {t('account.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link href={routes.favorites()} />}
        >
          {t('account.favorites')}
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<Link href={routes.contributions()} />}
        >
          {t('account.contributions')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
                <UnstyledButton type="submit" className="w-full text-left" aria-current={locale === targetLocale ? 'true' : undefined} />
              }
            >
              {t(targetLocale === 'zh-TW'
                ? 'nav.languageTraditionalChinese'
                : 'nav.languageEnglish')}
            </DropdownMenuItem>
          </form>
        ))}
        <DropdownMenuSeparator />
        <form action={routes.auth.signOut()} method="post" onSubmit={preserveCurrentUrl}>
          <input type="hidden" name="returnTo" defaultValue={pathname} />
          <DropdownMenuItem
            variant="destructive"
            render={
              <UnstyledButton type="submit" className="w-full text-left" onClick={handleSignOut} />
            }
          >
            {t('account.signOut')}
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
