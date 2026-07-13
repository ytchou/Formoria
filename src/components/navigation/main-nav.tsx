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
      <div className="page-gutter mx-auto flex h-14 max-w-screen-xl items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <BrandMark size={32} />
          <span className="type-section-title">
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
            className="type-body-emphasis text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('about')}
          </Link>
          {hasOwnedBrand ? (
            <Link
              href="/dashboard"
              className={buttonVariants({ variant: 'primary' })}
            >
              {t('myBrands')}
            </Link>
          ) : (
            <Link
              href="/submit"
              className={buttonVariants({ variant: 'primary', tone: 'cta' })}
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
                  type="button"
                  // eslint-disable-next-line no-restricted-syntax -- ui-exception: render-prop injection for SheetPrimitive.Trigger, raw button is required by Base UI render prop API
                  className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                  aria-label={t('openMenu')}
                />
              }
            >
              <Menu className="size-5" />
            </SheetPrimitive.Trigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">{t('navigation')}</SheetTitle>
              <div className="flex flex-col gap-4 pt-8">
                {/* Search in mobile sheet */}
                <div className="px-1">
                  <NavSearchInput />
                </div>

                <Link
                  href="/about"
                  className="block px-1 type-body-emphasis"
                  onClick={() => setOpen(false)}
                >
                  {t('about')}
                </Link>
                {hasOwnedBrand ? (
                  <Link
                    href="/dashboard"
                    className={buttonVariants({ variant: 'primary', className: 'w-full' })}
                    onClick={() => setOpen(false)}
                  >
                    {t('myBrands')}
                  </Link>
                ) : (
                  <Link
                    href="/submit"
                    className={buttonVariants({ variant: 'primary', tone: 'cta', className: 'w-full' })}
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
