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
import { routes } from '@/lib/routes'

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
  // Starts `true` on every render path, server and client alike: the hero IS on
  // screen at the top of `/`, so the header search starts hidden with no
  // first-paint flash and no hydration mismatch. A browser global read in the
  // initialiser would resolve differently on the two sides and cause one.
  const [heroVisible, setHeroVisible] = useState(true)
  useEffect(() => {
    if (!isHome) return
    // THE SEARCH MUST NEVER BE UNREACHABLE. Every branch below that cannot
    // observe the hero resolves to "show it" — a hidden search with no way back
    // is a dead end, an early-revealed one is only a duplicated control.
    //
    // The fallback is scheduled rather than called inline because a synchronous
    // setState in an effect body trips react-hooks/set-state-in-effect. One
    // frame of delay is invisible on a path that only runs when the observer
    // cannot work at all.
    const revealSearch = () => setHeroVisible(false)
    if (typeof IntersectionObserver === 'undefined') {
      const frame = requestAnimationFrame(revealSearch)
      return () => cancelAnimationFrame(frame)
    }

    // The hero publishes its bottom edge as `[data-hero-sentinel]`
    // (hero-section.tsx). Observing it replaces a hardcoded `scrollY > 420`
    // that stood in for the hero's height while being coupled to nothing: the
    // hero grows with the copy, the locale and the font, so the threshold was
    // wrong on the EN homepage the day it was written.
    //
    // It also removes a mount-time latch. The old handler read `window.scrollY`
    // eagerly, so a client-side navigation to `/` from a deep scroll position
    // revealed the search before the router had reset the scroll. An observer
    // has no such reading: its first callback reports where the sentinel
    // actually is once the new page has laid out.
    const sentinel = document.querySelector('[data-hero-sentinel]')
    if (!sentinel) {
      const frame = requestAnimationFrame(revealSearch)
      return () => cancelAnimationFrame(frame)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // `.at(-1)` rather than `[0]`: a single observation can deliver several
        // entries, and the last is the current state.
        const entry = entries.at(-1)
        if (!entry) return
        setHeroVisible(entry.isIntersecting)
      },
      // The header is `h-14`, so the sentinel is "gone" once it slides under
      // the sticky bar rather than when it leaves the viewport underneath it.
      { rootMargin: '-56px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isHome])

  const showNavSearch = !isHome || !heroVisible

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      {/* Row 1: Logo | Search | Actions.
          `header-measure`, NOT `page-measure`: the header stays at 80rem on
          every route, while `--page-measure` widens to 100rem under the landing
          page. A header that changed width between routes would read as the
          page jumping. The exclusion is stated in globals.css. */}
      <div className="page-gutter mx-auto flex h-14 header-measure items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <BrandMark size={32} />
          <span className="type-card-title">
            Formoria
          </span>
        </Link>

        {/* Search — center, takes remaining space (desktop only). The wrapper
            is unconditional so it keeps holding the `flex-1` gap between the
            logo and the actions; only its contents come and go. */}
        <div className="hidden flex-1 md:block">
          {/* HIDDEN, NEVER UNMOUNTED. Unmounting threw away an in-progress
              query the moment the reader scrolled back up to the hero, and the
              field came back empty. `hidden` is `display: none`, so while it is
              concealed the input is neither focusable nor announced — a
              visually-hidden-but-focusable field here would be a tab stop
              pointing at nothing on screen.

              `animate-in fade-in-0` is neutralised by the global
              prefers-reduced-motion rule in globals.css, so no extra guard here. */}
          <div
            className={
              showNavSearch ? 'animate-in fade-in-0 duration-200' : 'hidden'
            }
          >
            <NavSearchInput />
          </div>
        </div>

        {/* Right actions (desktop). A `nav` rather than a `div`: NavCategoryTabs
            below used to be the header's only navigation landmark, so gating it
            off the homepage left the banner with none at all. */}
        <nav aria-label={t('navigation')} className="hidden items-center gap-4 md:flex">
          <Link
            href={routes.whereToBuy()}
            className="type-body-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('whereToBuy')}
          </Link>
          <Link
            href={routes.discover()}
            className="type-body-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('discover')}
          </Link>
          <Link
            href={routes.about()}
            className="type-body-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
          >
            {t('about')}
          </Link>
          {hasOwnedBrand && ownerFeaturesEnabled ? (
            <Link
              href={routes.dashboard.index()}
              className={buttonVariants({ variant: 'primary' })}
            >
              {t('myBrands')}
            </Link>
          ) : (
            <Link
              href={routes.submit.index()}
              data-ph-no-autocapture
              onClick={() =>
                trackCtaClicked('submit_brand', 'header_nav', routes.submit.index(), pathname)
              }
              className={buttonVariants({ variant: 'primary' })}
            >
              {t('submitBrand')}
            </Link>
          )}
          {!user ? <LocaleSwitcher /> : null}
          <AccountMenu />
        </nav>

        {/* Mobile hamburger. A `nav` rather than a `div`, for the same reason
            the desktop actions are one: the actions element is `md:flex`, so it
            is `display: none` below 768px and exposes no landmark there, and
            NavCategoryTabs — the header's other navigation — is suppressed on
            `/` entirely. Without this the homepage banner had no navigation
            landmark at all on a phone, only a button. */}
        <nav aria-label={t('navigation')} className="ml-auto md:hidden">
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
                  href={routes.whereToBuy()}
                  className="flex min-h-11 items-center px-1 type-body-sm font-medium text-ink"
                  onClick={() => setOpen(false)}
                >
                  {t('whereToBuy')}
                </Link>

                <Link
                  href={routes.discover()}
                  className="flex min-h-11 items-center px-1 type-body-sm font-medium text-ink"
                  onClick={() => setOpen(false)}
                >
                  {t('discover')}
                </Link>

                <Link
                  href={routes.about()}
                  className="flex min-h-11 items-center px-1 type-body-sm font-medium text-ink"
                  onClick={() => setOpen(false)}
                >
                  {t('about')}
                </Link>
                {hasOwnedBrand && ownerFeaturesEnabled ? (
                  <Link
                    href={routes.dashboard.index()}
                    className={buttonVariants({ variant: 'primary', className: 'w-full' })}
                    onClick={() => setOpen(false)}
                  >
                    {t('myBrands')}
                  </Link>
                ) : (
                  <Link
                    href={routes.submit.index()}
                    data-ph-no-autocapture
                    onClick={() => {
                      trackCtaClicked('submit_brand', 'header_nav', routes.submit.index(), pathname)
                      setOpen(false)
                    }}
                    className={buttonVariants({ variant: 'primary', className: 'w-full' })}
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
        </nav>
      </div>

      {/* Row 2: Category tabs — suppressed on `/`, where the hero renders all
          12 L1s directly. Unlike the search field this does not come back on
          scroll: the homepage below the hero is its own browse surface. */}
      {isHome ? null : <NavCategoryTabs categories={categories} />}
    </header>
  )
}
