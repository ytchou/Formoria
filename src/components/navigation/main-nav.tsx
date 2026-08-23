"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AccountMenu } from "@/components/auth/account-menu";
import { NavSearchInput } from "./nav-search-input";
import { NavCategoryTabs } from "./nav-category-tabs";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { useUser } from "@/lib/auth/use-user";
import { trackCtaClicked } from "@/lib/analytics";
import { routes } from "@/lib/routes";

interface MainNavProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>;
}

export function MainNav({ categories }: MainNavProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("nav");
  // Reads `user` with no loading gate: the only thing it drives is whether the
  // signed-out LocaleSwitcher renders, and ViewerProvider commits `user` in the
  // same update as the rest of the viewer state (DEV-1414). Anything added here
  // that depends on `viewer` needs a `viewerLoading` gate first.
  const { user } = useUser();
  const pathname = usePathname();

  /**
   * The mock's four destinations, in its order. Declared once and rendered
   * twice — the desktop row and the mobile sheet used to be two hand-kept lists
   * that had already drifted apart by one link.
   */
  const primaryLinks = [
    { href: routes.discover(), label: t("discover") },
    { href: routes.brands(), label: t("brands") },
    { href: routes.stories(), label: t("stories") },
    { href: routes.about(), label: t("about") },
  ];

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
        <nav
          aria-label={t("navigation")}
          className="hidden items-center gap-5 md:flex"
        >
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
          <Link
            href={routes.submit.index()}
            data-ph-no-autocapture
            onClick={() =>
              trackCtaClicked(
                "submit_brand",
                "header_nav",
                routes.submit.index(),
                pathname,
              )
            }
            className={buttonVariants({ variant: "primary" })}
          >
            {t("submitBrand")}
          </Link>
          <AccountMenu />
        </nav>

        {/* Mobile hamburger. A `nav` rather than a `div`, for the same reason
            the desktop actions are one: the actions element is `md:flex`, so it
            is `display: none` below 768px and exposes no landmark there. This
            is the first navigation landmark in the banner at 375px, which
            mobile.spec.ts asserts by role. */}
        <nav aria-label={t("navigation")} className="ml-auto md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("openMenu")}
                />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            {/* `size="panel"` IS STATED, NOT INHERITED. It is also the
                shell's default, and the width it names (24rem) is the one this
                menu wants; spelling it keeps the width a decision this file
                made. The `w-72` that used to sit here never applied at all —
                the shell's `data-[side=right]` width outranks a plain `w-*`
                from a call site. */}
            <SheetContent side="right" size="panel">
              {/* NO `SheetHeader`. The title here is `sr-only`, and a ruled
                  header above an invisible title draws a hairline over nothing.
                  `pt-14` (3.5rem) is what clears the absolutely-positioned
                  close button: `size="icon"` is 2.75rem tall and the shell
                  insets it 0.5rem from the top, so its bottom edge lands at
                  3.25rem and the search field below it starts a quarter of a
                  rem clear. `px-0` keeps the slot from adding a second inset on
                  top of the per-row `px-1` / `px-4` this list already
                  carries. */}
              <SheetTitle className="sr-only">{t("navigation")}</SheetTitle>
              <SheetBody className="flex flex-col gap-4 px-0 pt-14">
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

                <Link
                  href={routes.submit.index()}
                  data-ph-no-autocapture
                  onClick={() => {
                    trackCtaClicked(
                      "submit_brand",
                      "header_nav",
                      routes.submit.index(),
                      pathname,
                    );
                    setOpen(false);
                  }}
                  className={buttonVariants({
                    variant: "primary",
                    width: "full",
                  })}
                >
                  {t("submitBrand")}
                </Link>
                <div className="px-4">
                  <LocaleSwitcher compact />
                </div>
                <div className="px-4">
                  <AccountMenu />
                </div>
              </SheetBody>
            </SheetContent>
          </Sheet>
        </nav>
      </PageShell>

      {/* Row 2: the L1 category row, on EVERY route including `/` (D18). It was
          suppressed on the homepage while the hero rendered its own chip block;
          that block is deleted, so the categories live in exactly one place. */}
      <NavCategoryTabs categories={categories} />
    </header>
  );
}
