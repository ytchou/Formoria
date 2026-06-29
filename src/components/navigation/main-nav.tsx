'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Menu } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import { AccountMenu } from '@/components/auth/account-menu'
import { useUser } from '@/lib/auth/use-user'
import { NavSearchInput } from './nav-search-input'
import { NavCategoryTabs } from './nav-category-tabs'
import { BrandMark } from '@/lib/brand/BrandMark'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'

interface MainNavProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>
}

export function MainNav({ categories }: MainNavProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('nav')
  const { user } = useUser()

  return (
    <header className="border-b border-border bg-background">
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
            href="/about"
            className="text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('about')}
          </Link>
          <Link
            href="/submit"
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('submitBrand')}
          </Link>
          {user && (
            <Link
              href="/dashboard"
              className="rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('myBrands')}
            </Link>
          )}
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
                  href="/about"
                  className="block px-1 text-sm font-medium text-foreground"
                  onClick={() => setOpen(false)}
                >
                  {t('about')}
                </Link>
                <Link
                  href="/submit"
                  className="block rounded-full bg-primary px-5 py-3 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  onClick={() => setOpen(false)}
                >
                  {t('submitBrand')}
                </Link>
                {user && (
                  <Link
                    href="/dashboard"
                    className="block rounded-full border border-border px-5 py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    onClick={() => setOpen(false)}
                  >
                    {t('myBrands')}
                  </Link>
                )}
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
