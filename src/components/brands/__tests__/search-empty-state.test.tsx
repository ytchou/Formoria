// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { routes } from "@/lib/routes";
import {
  SearchEmptyState,
  type ActiveDirectoryFilter,
} from "../search-empty-state";

// Key-as-value: this spec is about which routes out exist, not which words
// describe them, and a key reads unambiguously in an assertion.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "zh-TW",
}));
vi.mock("@/lib/analytics", () => ({ trackCtaClicked: vi.fn() }));
// The reader's actual URL, filters and all. `clearDirectoryFilters` is the REAL
// helper the sidebar's clear-all uses — mocking it would leave this spec unable
// to notice the two exits drifting apart.
vi.mock("next/navigation", () => ({
  usePathname: () => "/categories/home",
  useSearchParams: () => new URLSearchParams("price=1&search=kettle&page=3"),
}));

const FILTER: ActiveDirectoryFilter = {
  id: "category-home",
  label: "Category",
  value: "Home",
  removeHref: "/categories/home",
  removeLabel: "Remove Category: Home",
};

function renderEmptyState(
  props: Partial<Parameters<typeof SearchEmptyState>[0]> = {},
) {
  return render(
    <SearchEmptyState
      query=""
      activeFilters={[]}
      recommendedBrands={[]}
      recommendationsHref={routes.brands()}
      {...props}
    />,
  );
}

/*
 * A zero-result page is the one page that cannot end. The reader asked for
 * something the directory does not have, so every exit has to be drawn for
 * them — leaving them with a sentence explaining the emptiness and nothing to
 * click is the defect, not the emptiness itself.
 *
 * `recommendedBrands` is EMPTY in most of these on purpose. The directory only
 * loads fallback recommendations for `/brands`, never for a category route
 * (`directory-view.tsx` gates on `!isCategoryRoute`), so an empty category is
 * exactly where the dead end used to be reachable in production.
 */
describe("SearchEmptyState", () => {
  it("always offers a route back to the whole directory", () => {
    renderEmptyState();

    expect(
      screen.getByRole("link", { name: /actions\.browseAll\.title/ }),
    ).toHaveAttribute("href", routes.brands());
  });

  it("offers the same route out with no recommendations to fall back on", () => {
    const { container } = renderEmptyState({
      query: "unmatchable",
      activeFilters: [FILTER],
    });

    // Not "some link exists" — every link on the page must go somewhere real.
    const hrefs = Array.from(container.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => Boolean(href) && href !== "#")).toBe(true);
    expect(hrefs).toContain(routes.brands());
  });

  it("offers to drop the filters that emptied the page, keeping the search", () => {
    renderEmptyState({ query: "kettle", activeFilters: [FILTER] });

    // Clearing filters keeps what the reader asked for and widens where it is
    // looked for; browsing everything abandons the question. Both are offered,
    // and they are different destinations — a single "start over" would hide
    // the cheaper of the two.
    const href = screen
      .getByRole("link", { name: /actions\.clearFilters\.title/ })
      .getAttribute("href");

    expect(href).toContain("search=kettle");
    expect(href).not.toContain("price=");
    // Page 3 of a result set that no longer exists is not a destination.
    expect(href).not.toContain("page=");
  });

  it("offers no clear-filters route when nothing is filtered", () => {
    renderEmptyState({ query: "unmatchable" });

    expect(
      screen.queryByRole("link", { name: /actions\.clearFilters\.title/ }),
    ).toBeNull();
  });

  it("offers to recommend the brand the reader searched for", () => {
    renderEmptyState({ query: "未收錄品牌" });

    expect(
      screen.getByRole("link", { name: /actions\.recommendBrand\.title/ }),
    ).toHaveAttribute("href", routes.submit.recommend({ name: "未收錄品牌" }));
  });
});
