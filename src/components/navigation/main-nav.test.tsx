/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";

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
    viewer: { isAdmin: false },
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
      <MainNav />
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

  it("keeps category tabs out of the global header", () => {
    pathname = "/brands";
    const { container } = renderNav();

    for (const category of L1_CATEGORIES) {
      expect(
        container.querySelectorAll(`a[href="/en/categories/${category.slug}"]`),
      ).toHaveLength(0);
    }
  });

  it("keeps a search field in the header on the homepage when no hero search exists", async () => {
    // The header search yields to the hero's search on `/` (see the next
    // case), but only once the hero's form is found. Without one — jsdom has
    // no IntersectionObserver and this render has no hero — it fails OPEN:
    // there is no state in which the header offers no search at all.
    renderNav();

    const search = screen.getByRole("search", { name: en.nav.searchAria });
    expect(search.className).not.toContain("hidden");
    await waitFor(() =>
      expect(search.parentElement).not.toHaveClass("invisible"),
    );
  });

  it("hides the header search on the homepage while the hero search is in view", () => {
    let report: (isIntersecting: boolean) => void = () => {};
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) {
        report = (isIntersecting) =>
          act(() =>
            callback(
              [{ isIntersecting } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
          );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;

    // The hero's form, as `ProductSearchBoxCompact src="hero"` renders it.
    const hero = document.createElement("form");
    hero.innerHTML = '<input type="hidden" name="src" value="hero">';
    document.body.append(hero);

    try {
      renderNav();
      const wrapper = screen.getByRole("search", {
        name: en.nav.searchAria,
      }).parentElement;

      report(true);
      expect(wrapper).toHaveClass("invisible");

      report(false);
      expect(wrapper).not.toHaveClass("invisible");
    } finally {
      hero.remove();
      globalThis.IntersectionObserver = original;
    }
  });

  it("marks the current route's link as the current page", async () => {
    pathname = "/brands/some-brand";
    renderNav();

    // The desktop row is the first `Main menu` landmark in the banner.
    const desktop = screen.getAllByRole("navigation", {
      name: en.nav.navigation,
    })[0]!;
    const current = within(desktop)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/brands");

    fireEvent.click(screen.getByRole("button", { name: en.nav.openMenu }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("link", { name: en.nav.brands }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(dialog).getByRole("link", { name: en.nav.style }),
    ).not.toHaveAttribute("aria-current");
  });

  it("opening the menu focuses the sheet, not its search field", async () => {
    // Default Base UI focus lands on the first tabbable element — the search
    // field — which on a phone raises the keyboard over the menu.
    pathname = "/about";
    renderNav();

    fireEvent.click(screen.getByRole("button", { name: en.nav.openMenu }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveFocus());
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

});
