'use client'

import { useEffect, useState } from 'react'
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
import { buttonVariants } from '@/components/ui/button'
import { useUser } from '@/lib/auth/use-user'
import { trackCtaClicked } from '@/lib/analytics'

interface MainNavProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>
}

export function MainNav({ categories }: MainNavProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('nav')
  // Reads `user` and `viewer` with no loading gate, which is only safe because
  // ViewerProvider commits both in the same update — `viewer` can never resolve
  // first. If that ever changes, this renders "My Brands" beside the signed-out
  // LocaleSwitcher below (DEV-1414); add a `viewerLoading` gate here first.
  const { user, viewer } = useUser()
  const hasOwnedBrand = viewer.hasOwnedBrand
  const ownerFeaturesEnabled = viewer.ownerFeaturesEnabled
  const pathname = usePathname()

  // The homepage hero owns both entry modes — a search field and all 12 L1
  // chips — so the header's copies of them are pure duplication within one
  // viewport. Every other route keeps them; `/brands` in particular relies on
  // the tab row as its primary control surface.
  const isHome = pathname === '/'
  const [scrolledPastHero, setScrolledPastHero] = useState(false)
  useEffect(() => {
    if (!isHome) return
    // Fixed 420px threshold approximates the hero's height; switch to an
    // IntersectionObserver on a hero sentinel if the hero's height becomes
    // variable. Search must never be unreachable, so it fades back in once the
    // hero has scrolled away.
    const onScroll = () => setScrolledPastHero(window.scrollY > 420)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isHome])

  const showNavSearch = !isHome || scrolledPastHero

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      {/* Row 1: Logo | Search | Actions */}
      <div className="page-gutter mx-auto flex h-14 max-w-screen-xl items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <BrandMark size={32} />
          <span className="type-section-title">
            Formoria
          </span>
        </Link>

        {/* Search — center, takes remaining space (desktop only). The wrapper
            is unconditional so it keeps holding the `flex-1` gap between the
            logo and the actions; only its contents come and go. */}
        <div className="hidden flex-1 md:block">
          {showNavSearch ? (
            // `animate-in fade-in-0` is neutralised by the global
            // prefers-reduced-motion rule in globals.css, so no extra guard here.
            <div className="animate-in fade-in-0 duration-200">
              <NavSearchInput />
            </div>
          ) : null}
        </div>

        {/* Right actions (desktop). A `nav` rather than a `div`: NavCategoryTabs
            below used to be the header's only navigation landmark, so gating it
            off the homepage left the banner with none at all. */}
        <nav aria-label={t('navigation')} className="hidden items-center gap-4 md:flex">
          <Link
            href="/where-to-buy"
            className="type-body-emphasis text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('whereToBuy')}
          </Link>
          <Link
            href="/discover"
            className="type-body-emphasis text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('discover')}
          </Link>
          <Link
            href="/about"
            className="type-body-emphasis text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('about')}
          </Link>
          {hasOwnedBrand && ownerFeaturesEnabled ? (
            <Link
              href="/dashboard"
              className={buttonVariants({ variant: 'primary' })}
            >
              {t('myBrands')}
            </Link>
          ) : (
            <Link
              href="/submit"
              data-ph-no-autocapture
              onClick={() => trackCtaClicked('submit_brand', 'header_nav', '/submit', pathname)}
              className={buttonVariants({ variant: 'primary', tone: 'cta' })}
            >
              {t('submitBrand')}
            </Link>
          )}
          {!user ? <LocaleSwitcher /> : null}
          <AccountMenu />
        </nav>

        {/* Mobile hamburger */}
        <div className="ml-auto md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetPrimitive.Trigger
              render={
                <button
                  type="button"
                  // eslint-disable-next-line no-restricted-syntax -- ui-exception: render-prop injection for SheetPrimitive.Trigger, raw button is required by Base UI render prop API
                  className={buttonVariants({
                    variant: 'ghost',
                    size: 'icon',
                    className: 'size-11',
                  })}
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
                  href="/where-to-buy"
                  className="flex min-h-11 items-center px-1 type-body-emphasis"
                  onClick={() => setOpen(false)}
                >
                  {t('whereToBuy')}
                </Link>

                <Link
                  href="/discover"
                  className="flex min-h-11 items-center px-1 type-body-emphasis"
                  onClick={() => setOpen(false)}
                >
                  {t('discover')}
                </Link>

                <Link
                  href="/about"
                  className="flex min-h-11 items-center px-1 type-body-emphasis"
                  onClick={() => setOpen(false)}
                >
                  {t('about')}
                </Link>
                {hasOwnedBrand && ownerFeaturesEnabled ? (
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
                    data-ph-no-autocapture
                    onClick={() => {
                      trackCtaClicked('submit_brand', 'header_nav', '/submit', pathname)
                      setOpen(false)
                    }}
                    className={buttonVariants({ variant: 'primary', tone: 'cta', className: 'w-full' })}
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

      {/* Row 2: Category tabs — suppressed on `/`, where the hero renders all
          12 L1s directly. Unlike the search field this does not come back on
          scroll: the homepage below the hero is its own browse surface. */}
      {isHome ? null : <NavCategoryTabs categories={categories} />}
    </header>
  )
}
