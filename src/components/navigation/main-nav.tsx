'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { Menu } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import { AccountMenu } from '@/components/auth/account-menu'
import { NavSearchInput } from './nav-search-input'
import { NavCategoryTabs } from './nav-category-tabs'
import { BrandMark } from '@/lib/brand/BrandMark'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'

interface MainNavProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>
}

export function MainNav({ categories }: MainNavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const t = useTranslations('nav')

  function isActive(href: string) {
    return pathname.startsWith(href)
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      {/* Row 1: Logo | Search | Actions */}
      <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-4 px-6">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <BrandMark size={32} />
          <span className="font-heading text-base font-bold text-foreground">
            Formoria
          </span>
        </Link>

        {/* Search — center, takes remaining space (desktop only) */}
        <div className="hidden flex-1 md:block">
          <NavSearchInput />
        </div>

        {/* Right actions (desktop) */}
        <div className="hidden items-center gap-4 md:flex">
          <Link
            href="/brands"
            className={`text-sm transition-colors ${
              isActive('/brands')
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('brandDirectory')}
          </Link>
          <Link
            href="/faq"
            className={`text-sm transition-colors ${
              isActive('/faq')
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('faq')}
          </Link>
          <Link
            href="/support"
            className={`text-sm transition-colors ${
              isActive('/support')
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('support')}
          </Link>
          <Link
            href="/my-submissions"
            className={`text-sm transition-colors ${
              isActive('/my-submissions')
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('mySubmissions')}
          </Link>
          <Link
            href="/submit"
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('submitBrand')}
          </Link>
          <LocaleSwitcher />
          <AccountMenu />
        </div>

        {/* Mobile hamburger */}
        <div className="ml-auto md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetPrimitive.Trigger
              render={
                <button
                  className="inline-flex size-10 items-center justify-center rounded-lg"
                  aria-label="Open menu"
                />
              }
            >
              <Menu className="size-5" />
            </SheetPrimitive.Trigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex flex-col gap-4 pt-8">
                {/* Search in mobile sheet */}
                <div className="px-1">
                  <NavSearchInput />
                </div>

                <Link
                  href="/brands"
                  className={`block rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                    isActive('/brands')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-secondary'
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {t('brandDirectory')}
                </Link>
                <Link
                  href="/faq"
                  className={`block rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                    isActive('/faq')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-secondary'
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {t('faq')}
                </Link>
                <Link
                  href="/support"
                  className={`block rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                    isActive('/support')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-secondary'
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {t('support')}
                </Link>
                <Link
                  href="/my-submissions"
                  className={`block rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                    isActive('/my-submissions')
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-secondary'
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {t('mySubmissions')}
                </Link>
                <Link
                  href="/submit"
                  className="block rounded-full bg-primary px-5 py-3 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  onClick={() => setOpen(false)}
                >
                  {t('submitBrand')}
                </Link>
                <div className="px-4">
                  <LocaleSwitcher />
                </div>
                <div className="px-4">
                  <AccountMenu />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Row 2: Category tabs */}
      <NavCategoryTabs categories={categories} />
    </header>
  )
}
