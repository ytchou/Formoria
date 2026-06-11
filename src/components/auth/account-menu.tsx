'use client'

import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { Link } from '@/i18n/navigation'

import { signOut } from '@/app/auth/actions'
import { useUser } from '@/lib/auth/use-user'
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
  const pathname = usePathname()

  if (loading) {
    return <div data-account-menu-placeholder className="h-9 w-12" aria-hidden />
  }

  if (!user) {
    return (
      <Link
        href={`/auth/sign-in?next=${encodeURIComponent(pathname)}`}
        className="inline-flex h-9 items-center justify-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {t('nav.signIn')}
      </Link>
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
          render={<Link href="/my-submissions" />}
        >
          {t('nav.mySubmissions')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href="/dashboard" />}
        >
          {t('account.dashboard')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOut.bind(null, pathname)}>
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
