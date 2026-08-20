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
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'
import { buttonVariants } from '@/components/ui/button'
import { PageShell } from '@/components/ui/page-shell'
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

  /**
   * The mock's five destinations, in its order. Declared once and rendered
   * twice — the desktop row and the mobile sheet used to be two hand-kept lists
   * that had already drifted apart by one link.
   */
  const primaryLinks = [
    { href: routes.discover(), label: t('discover') },
    { href: routes.brands(), label: t('brands') },
    { href: routes.stories(), label: t('stories') },
    { href: routes.whereToBuy(), label: t('whereToBuy') },
    { href: routes.about(), label: t('about') },
  ]

  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-ground">
      {/* Row 1: wordmark | search | links.
          THE HEIGHT IS `--nav-row-primary`, NOT A LITERAL. Six sticky elements
          park below the header with `top-(--nav-height)`, and that token is a
          `calc()` of this row, the category row and the bottom hairline. A
          literal here desyncs the six the moment it changes — which is exactly
          how they came to sit 13px under a z-50 bar. `nav-height.test.ts`
          fails if this row stops reading the token — it reads this className,
          so keep the height token IN the class string rather than moving it
          onto a wrapper.
          THE WIDTH IS `PageShell`, the same shell every route root reads. The
          header used to be held at its own fixed 80rem while the landing bands
          sat at 100rem, which is the 160px seam down one page this ticket was
          filed for. Sharing ONE measure is what closed it: the header begins at
          the same left edge as the content under it, on every route, and it
          takes the same 1280px gutter step the content takes. */}
      <PageShell
        measure="page"
        className="flex h-(--nav-row-primary) items-center gap-6"
      >
        {/* The wordmark alone — the content face (`font-ming`), no mark. The
            vectorized mark is still the favicon and still opens the auth
            layout; in the nav it competed with the wordmark beside it at
            32px. */}
        <Link href={routes.home()} className="shrink-0 type-card-title">
          Formoria
        </Link>

        {/* THE HEADER SEARCH IS UNCONDITIONAL, INCLUDING ON `/`.
            It used to be hidden on the homepage until an IntersectionObserver
            reported the hero photograph had left the viewport — a state
            machine, a sentinel element in another component, and a documented
            "the search must never be unreachable" hazard, all to avoid showing
            two search fields in one viewport. The opener is editorial now and
            the approved mock draws both, so the whole mechanism is deleted
            rather than re-tuned. The two fields carry different accessible
            names (`landing.hero.searchLabel` and `brands.search.aria`), so they
            are distinguishable to a screen reader. */}
        <div className="hidden flex-1 md:block">
          <NavSearchInput />
        </div>

        {/* Right actions (desktop). A `nav` rather than a `div`: this and the
            category row below are the header's navigation landmarks. */}
        <nav aria-label={t('navigation')} className="hidden items-center gap-5 md:flex">
          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="type-nav transition-colors hover:text-accent"
            >
              {link.label}
            </Link>
          ))}
          {!user ? <LocaleSwitcher /> : null}
          {/* NOT in the approved mock, and it stays: owner-features-flag-off
              and dashboard-tabs both assert this link's presence or absence
              inside `header`. */}
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
          <AccountMenu />
        </nav>

        {/* Mobile hamburger. A `nav` rather than a `div`, for the same reason
            the desktop actions are one: the actions element is `md:flex`, so it
            is `display: none` below 768px and exposes no landmark there. This
            is the first navigation landmark in the banner at 375px, which
            mobile.spec.ts asserts by role. */}
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

                {primaryLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex min-h-11 items-center px-1 type-nav"
                    onClick={() => setOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}

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
      </PageShell>

      {/* Row 2: the L1 category row, on EVERY route including `/` (D18). It was
          suppressed on the homepage while the hero rendered its own chip block;
          that block is deleted, so the categories live in exactly one place. */}
      <NavCategoryTabs categories={categories} />
    </header>
  )
}
