// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandFilterSidebar } from "./brand-filter-sidebar";

const mockTrackSubcategoryFilterApplied = vi.fn();
const mockTrackPriceFilterApplied = vi.fn();
const mockTrackVerificationFilterApplied = vi.fn();
const mockTrackFilterCleared = vi.fn();

vi.mock("@/lib/analytics", () => ({
  trackCategoryFilterApplied: vi.fn(),
  trackSubcategoryFilterApplied: (...args: unknown[]) =>
    mockTrackSubcategoryFilterApplied(...args),
  trackPriceFilterApplied: (...args: unknown[]) =>
    mockTrackPriceFilterApplied(...args),
  trackVerificationFilterApplied: (...args: unknown[]) =>
    mockTrackVerificationFilterApplied(...args),
  trackFilterCleared: (...args: unknown[]) => mockTrackFilterCleared(...args),
}));

const replace = vi.fn();
let query = "";

const subs = [
  { slug: "clasp-frame-bags", label: "口金包", count: 8 },
  { slug: "backpacks", label: "後背包", count: 19 },
];

vi.mock("next/navigation", () => ({
  usePathname: () => "/brands",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (namespace: string) =>
    (key: string, values?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        "brands.filters.appliedHint":
          "Select × on a tag to remove that filter.",
        "brands.filters.currentConditions": "Current filters",
        "brands.filters.brandSearch": "Brand name search",
        "brands.filters.brandSearchHelp": "Applied with every active filter",
        "brands.filters.brandSearchLandmark": "Filter brands by name",
        "brands.filters.activeSearch": "Brand search",
        "brands.filters.activeCategory": "Category",
        "brands.filters.activeSubcategory": "Subcategory",
        "brands.filters.activePrice": "Price range",
        "brands.filters.activeStatus": "Brand status",
        "brands.filters.removeFilter": `Remove ${values?.label ?? ""} ${values?.value ?? ""}`,
        "brands.filters.clearAll": "Clear all",
        "brands.filters.category": "Category",
        "brands.filters.priceRange": "Price range",
        "brands.filters.brandStatus": "Brand status",
        "brands.verificationFilter.all": "All",
        "brands.verificationFilter.mit-verified": "MIT verified",
        "brands.verificationFilter.mit-declared": "品牌聲明",
        "brands.verificationFilter.owned": "Brand managed",
      };
      return messages[`${namespace}.${key}`] ?? key;
    },
}));

vi.mock("./search-input", () => ({
  SearchInput: ({ formAriaLabel }: { formAriaLabel: string }) => (
    <form role="search" aria-label={formAriaLabel}>
      <input role="searchbox" />
    </form>
  ),
}));

describe("BrandFilterSidebar", () => {
  beforeEach(() => {
    query = "";
    replace.mockClear();
    mockTrackSubcategoryFilterApplied.mockClear();
    mockTrackPriceFilterApplied.mockClear();
    mockTrackVerificationFilterApplied.mockClear();
    mockTrackFilterCleared.mockClear();
  });

  it("renders price ranges as tags and writes the selected values to the URL", async () => {
    const user = userEvent.setup();
    render(<BrandFilterSidebar categories={[]} totalCount={0} />);

    await user.click(screen.getByRole("button", { name: /Price range/ }));
    await user.click(screen.getByRole("button", { name: "$$" }));

    expect(replace).toHaveBeenCalledWith("/brands?price=2", { scroll: false });
  });

  it("renders active filters as removable chips in the summary band", () => {
    query = "category=jewelry";
    render(
      <BrandFilterSidebar
        activeFilters={[
          {
            id: "category-jewelry",
            label: "Category",
            value: "Jewelry",
            removeHref: "/brands",
            removeLabel: "Remove Category Jewelry",
          },
        ]}
        categories={[{ slug: "jewelry", name: "Jewelry", nameZh: "飾品珠寶" }]}
        totalCount={9}
      />,
    );

    const summary = screen.getByRole("region", { name: "Current filters" });
    expect(
      within(summary).getByRole("link", {
        name: "Remove Category Jewelry",
      }),
    ).toHaveAttribute("href", "/brands");
    expect(
      within(summary).getByText("Select × on a tag to remove that filter."),
    ).toBeInTheDocument();
  });

  it("hides the active-filter summary when no filters are applied", () => {
    render(<BrandFilterSidebar categories={[]} totalCount={0} />);

    expect(
      screen.queryByRole("region", { name: "Current filters" }),
    ).not.toBeInTheDocument();
  });

  it("uses the same left-aligned option treatment for categories and status", async () => {
    const user = userEvent.setup();
    render(
      <BrandFilterSidebar
        totalCount={12}
        categories={[
          {
            slug: "bags-accessories",
            name: "Bags & accessories",
            nameZh: "包袋配件",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Category/ }));
    await user.click(screen.getByRole("button", { name: /Brand status/ }));

    const categoryCheckbox = screen.getByRole("checkbox", {
      name: "Bags & accessories",
    });
    const categoryLabel = categoryCheckbox.closest("label");
    const statusRadio = screen.getByRole("radio", { name: "All" });
    const statusLabel = statusRadio.closest("label");

    expect(categoryLabel?.firstElementChild).toBe(categoryCheckbox);
    expect(categoryLabel).not.toHaveClass("justify-between");
    expect(categoryLabel).toHaveClass("type-card-description");
    expect(statusLabel).toHaveClass("type-card-description");
  });

  it("shows the aggregate result count only beside a single selected category", async () => {
    query = "category=jewelry";
    const user = userEvent.setup();
    render(
      <BrandFilterSidebar
        totalCount={0}
        categories={[{ slug: "jewelry", name: "Jewelry", nameZh: "飾品珠寶" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Category/ }));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("offers the mit-declared verification option", async () => {
    const user = userEvent.setup();
    render(<BrandFilterSidebar categories={[]} totalCount={0} />);

    await user.click(screen.getByRole("button", { name: /Brand status/ }));

    expect(
      screen.getByRole("radio", { name: /品牌聲明/ }),
    ).toBeInTheDocument();
  });

  it("marks mit-declared active from the URL param", async () => {
    query = "verification=mit-declared";
    const user = userEvent.setup();
    render(<BrandFilterSidebar categories={[]} totalCount={0} />);

    await user.click(screen.getByRole("button", { name: /Brand status/ }));

    expect(screen.getByRole("radio", { name: /品牌聲明/ })).toBeChecked();
  });

  describe("subcategory chips", () => {
    it("renders chips under a checked category with counts", async () => {
      query = "category=bags-accessories&sub=clasp-frame-bags";
      const user = userEvent.setup();
      render(
        <BrandFilterSidebar
          totalCount={8}
          categories={[
            {
              slug: "bags-accessories",
              name: "Bags & accessories",
              nameZh: "包袋配件",
            },
          ]}
          subcategories={subs}
          activeSubSlugs={["clasp-frame-bags"]}
        />,
      );

      await user.click(screen.getByRole("button", { name: /Category/ }));
      expect(screen.getByRole("button", { name: "口金包 8" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "後背包 19" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("renders no chip block when subcategories is empty", () => {
      query = "category=bags-accessories";
      render(
        <BrandFilterSidebar
          totalCount={0}
          categories={[
            {
              slug: "bags-accessories",
              name: "Bags & accessories",
              nameZh: "包袋配件",
            },
          ]}
          subcategories={[]}
          activeSubSlugs={[]}
        />,
      );

      expect(
        screen.queryByRole("button", { name: /口金包/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("analytics tracking", () => {
    it("fires trackSubcategoryFilterApplied when an unchecked subcategory pill is clicked", async () => {
      query = "category=bags-accessories";
      const user = userEvent.setup();
      render(
        <BrandFilterSidebar
          totalCount={19}
          categories={[
            {
              slug: "bags-accessories",
              name: "Bags & accessories",
              nameZh: "包袋配件",
            },
          ]}
          subcategories={subs}
          activeSubSlugs={[]}
        />,
      );

      await user.click(screen.getByRole("button", { name: /Category/ }));
      await user.click(screen.getByRole("button", { name: "後背包 19" }));

      expect(mockTrackSubcategoryFilterApplied).toHaveBeenCalledWith(
        "backpacks",
        "bags-accessories",
      );
    });

    it("fires trackFilterCleared when an active subcategory pill is clicked to deselect it", async () => {
      query = "category=bags-accessories&sub=clasp-frame-bags";
      const user = userEvent.setup();
      render(
        <BrandFilterSidebar
          totalCount={8}
          categories={[
            {
              slug: "bags-accessories",
              name: "Bags & accessories",
              nameZh: "包袋配件",
            },
          ]}
          subcategories={subs}
          activeSubSlugs={["clasp-frame-bags"]}
        />,
      );

      await user.click(screen.getByRole("button", { name: /Category/ }));
      await user.click(screen.getByRole("button", { name: "口金包 8" }));

      expect(mockTrackFilterCleared).toHaveBeenCalledWith(
        "single",
        "subcategory",
        "clasp-frame-bags",
      );
    });

    it("fires trackPriceFilterApplied when a price pill is clicked", async () => {
      const user = userEvent.setup();
      render(<BrandFilterSidebar categories={[]} totalCount={0} />);

      await user.click(screen.getByRole("button", { name: /Price range/ }));
      await user.click(screen.getByRole("button", { name: "$$" }));

      expect(mockTrackPriceFilterApplied).toHaveBeenCalledWith("2");
    });

    it("fires trackVerificationFilterApplied when a verification radio is changed", async () => {
      const user = userEvent.setup();
      render(<BrandFilterSidebar categories={[]} totalCount={0} />);

      await user.click(screen.getByRole("button", { name: /Brand status/ }));
      await user.click(screen.getByRole("radio", { name: "品牌聲明" }));

      expect(mockTrackVerificationFilterApplied).toHaveBeenCalledWith(
        "mit-declared",
      );
    });
  });
});
