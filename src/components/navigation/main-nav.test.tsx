/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";

/**
 * D18 moves the whole L1 row into the persistent nav, so the homepage is the
 * case this file exists to pin: the row used to be suppressed on `/` because the
 * hero rendered its own chip block, and the chip block is gone.
 */
let pathname = "/";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({
    href,
    prefetch: _prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/use-user", () => ({
  useUser: () => ({
    user: null,
    loading: false,
    viewer: {
      hasOwnedBrand: false,
      ownerFeaturesEnabled: false,
      isAdmin: false,
    },
    viewerLoading: false,
    viewerError: false,
    refreshViewer: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-filter-params", () => ({
  useFilterParams: () => ({
    filters: { search: "" },
    isPending: false,
    setSearch: vi.fn(),
  }),
}));

vi.mock("@/lib/analytics", () => ({
  trackCategoryFilterApplied: vi.fn(),
  trackCtaClicked: vi.fn(),
  trackSearchExecuted: vi.fn(),
  trackSearchResultClicked: vi.fn(),
  trackSearchSuggestionSelect: vi.fn(),
}));

// Both pull in `@/app/actions/locale-preference`, a "use server" module that
// cannot load in jsdom. Neither is what this file is about.
vi.mock("@/components/auth/account-menu", () => ({
  AccountMenu: () => <div data-testid="account-menu" />,
}));
vi.mock("@/components/i18n/locale-switcher", () => ({
  LocaleSwitcher: () => <div data-testid="locale-switcher" />,
}));

const { MainNav } = await import("./main-nav");

function renderNav() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MainNav categories={[...L1_CATEGORIES]} />
    </NextIntlClientProvider>,
  );
}

describe("MainNav", () => {
  beforeEach(() => {
    pathname = "/";
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ results: [] }) }),
    ) as unknown as typeof fetch;
  });

  it("renders all 12 categories on the homepage", () => {
    // Read from the ontology, not from the mock: the mock merged `kids` and
    // `pets` into one chip, and DEV-1510 split them for a reason the nav does
    // not get to overrule. DEV-1507 then retired `crafts`, taking 13 to 12 —
    // the count moves with the vocabulary rather than being restated here.
    const { container } = renderNav();

    expect(L1_CATEGORIES).toHaveLength(12);
    for (const category of L1_CATEGORIES) {
      // `/en/…`, with the prefix written out. The tabs are raw anchors, not
      // `@/i18n/navigation`'s `Link`, because they must resolve with JS off, so
      // they carry the locale themselves via `localizePath` — the router path
      // handed to `router.push` stays prefix-free. ONE `/en`, never two: a
      // second prefix here would be the double-prefix bug `@/lib/routes`
      // exists to prevent, so the literal is spelled out rather than derived.
      const links = container.querySelectorAll(
        `a[href="/en/categories/${category.slug}"]`,
      );
      expect(links, `nav link for ${category.slug}`).toHaveLength(1);
      expect(links[0]).toHaveTextContent(category.name);
    }
  });

  it("keeps the category row on every other route", () => {
    pathname = "/brands";
    const { container } = renderNav();

    // Both shapes count. A clean category tab resolves to its taxonomy page,
    // but `buildCategoryTabTarget` keeps the state on the filtered directory
    // whenever a facet, a multi-select or a cross-L1 subcategory is live —
    // this spec is about the row surviving the route, not about which of the
    // two destinations a given tab picks.
    expect(
      container.querySelectorAll(
        'a[href^="/en/categories/"], a[href^="/en/brands"]',
      ),
    ).not.toHaveLength(0);
    expect(
      screen.getByRole("link", { name: en.nav.allBrands }),
    ).toBeInTheDocument();
  });

  it("keeps a search field in the header on the homepage", () => {
    // The header search used to be hidden on `/` until an IntersectionObserver
    // reported the hero photograph had scrolled away. The opener is editorial
    // now and the observer is gone, so the field is simply always there — no
    // observer, no hidden-but-mounted branch, no way to reach a state where the
    // header offers no search at all.
    renderNav();

    const search = screen.getAllByRole("search");
    expect(search.length).toBeGreaterThan(0);
    expect(search[0]!.className).not.toContain("hidden");
  });

  it("nav sheet still exposes its search form", async () => {
    // `search-edge-cases.spec.ts:234` opens the mobile menu and types into the
    // field inside it. The sheet body is a slot now rather than a hand-rolled
    // div, so this pins the thing that spec depends on: a `search` landmark
    // reachable INSIDE the dialog, not merely somewhere on the page — the
    // header renders a second one in the desktop row that would satisfy a
    // page-wide query while the sheet's had been dropped.
    renderNav();

    fireEvent.click(screen.getByRole("button", { name: en.nav.openMenu }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("search")).toBeInTheDocument();

    // The body is the slot, and it carries no `sheet-header`: the title in
    // this sheet is `sr-only`, so a ruled header would draw a rule over
    // nothing.
    const body = dialog.querySelector('[data-slot="sheet-body"]');
    expect(body).not.toBeNull();
    expect(body!.querySelector('[role="search"]')).not.toBeNull();
    expect(dialog.querySelector('[data-slot="sheet-header"]')).toBeNull();
  });

  it("keeps where-to-buy out of the header destinations", () => {
    // 推薦品牌 is NOT in the approved mock's nav, and it stays anyway:
    // owner-features-flag-off.spec.ts asserts it inside `header`.
    renderNav();

    const banner = screen.getByRole("banner");
    for (const [label, href] of [
      [en.nav.discover, "/discover"],
      [en.nav.brands, "/brands"],
      [en.nav.stories, "/stories"],
      [en.nav.about, "/about"],
      [en.nav.submitBrand, "/submit"],
    ] as const) {
      expect(
        within(banner).getAllByRole("link", { name: label })[0],
      ).toHaveAttribute("href", href);
    }
    expect(
      within(banner).queryByRole("link", { name: en.nav.whereToBuy }),
    ).not.toBeInTheDocument();
  });
});
