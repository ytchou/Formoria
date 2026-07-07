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
import { NavSearchInput } from './nav-search-input'
import { NavCategoryTabs } from './nav-category-tabs'
import { BrandMark } from '@/lib/brand/BrandMark'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface MainNavProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>
  hasOwnedBrand?: boolean
  isAuthenticated?: boolean
}

export function MainNav({ categories, hasOwnedBrand = false, isAuthenticated = false }: MainNavProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('nav')
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
            href="/guides"
            className="text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('guides')}
          </Link>
          {hasOwnedBrand ? (
            <Link
              href="/dashboard"
              className={cn(buttonVariants(), 'rounded-full')}
            >
              {t('myBrands')}
            </Link>
          ) : (
            <Link
              href="/submit"
              className={cn(buttonVariants({ variant: 'cta' }), 'rounded-full')}
            >
              {t('submitBrand')}
            </Link>
          )}
          {!isAuthenticated ? <LocaleSwitcher compact /> : null}
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
                  href="/guides"
                  className="block px-1 text-sm font-medium text-foreground"
                  onClick={() => setOpen(false)}
                >
                  {t('guides')}
                </Link>
                {hasOwnedBrand ? (
                  <Link
                    href="/dashboard"
                    className={cn(buttonVariants(), 'w-full rounded-full')}
                    onClick={() => setOpen(false)}
                  >
                    {t('myBrands')}
                  </Link>
                ) : (
                  <Link
                    href="/submit"
                    className={cn(buttonVariants({ variant: 'cta' }), 'w-full rounded-full')}
                    onClick={() => setOpen(false)}
                  >
                    {t('submitBrand')}
                  </Link>
                )}
                <div className="px-4">
                  <LocaleSwitcher compact />
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
