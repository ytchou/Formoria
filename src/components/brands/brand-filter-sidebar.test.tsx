// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandFilterSidebar } from "./brand-filter-sidebar";

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
        "brands.filters.appliedCount": `${values?.count ?? 0} filters applied`,
        "brands.filters.appliedHint": "Search and filters apply together",
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
        "brands.filters.clearCategories": "Clear categories",
        "brands.filters.category": "Category",
        "brands.filters.priceRange": "Price range",
        "brands.filters.brandStatus": "Brand status",
        "brands.verificationFilter.all": "All",
        "brands.verificationFilter.mit-verified": "MIT verified",
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
  });

  it("renders price ranges as tags and writes the selected values to the URL", async () => {
    const user = userEvent.setup();
    render(<BrandFilterSidebar categories={[]} totalCount={0} />);

    await user.click(screen.getByRole("button", { name: "$$" }));

    expect(replace).toHaveBeenCalledWith("/brands?price=2", { scroll: false });
  });

  it("counts and clears active price ranges", async () => {
    query = "price=1%2C3";
    const user = userEvent.setup();
    render(<BrandFilterSidebar categories={[]} totalCount={0} />);

    expect(screen.getByText("2 filters applied")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(replace).toHaveBeenCalledWith("/brands", { scroll: false });
  });

  it("uses the same left-aligned option treatment for categories and status", () => {
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

  it("counts search and category conditions and renders removable rows", () => {
    query = "search=herbs&category=jewelry&sort=name";
    render(
      <BrandFilterSidebar
        totalCount={0}
        categories={[{ slug: "jewelry", name: "Jewelry", nameZh: "飾品珠寶" }]}
      />,
    );

    expect(screen.getByText("2 filters applied")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Remove Brand search herbs" }),
    ).toHaveAttribute("href", "/brands?category=jewelry&sort=name");
    expect(
      screen.getByRole("link", { name: "Remove Category Jewelry" }),
    ).toHaveAttribute("href", "/brands?search=herbs&sort=name");
  });

  it("shows the aggregate result count only beside a single selected category", () => {
    query = "category=jewelry";
    render(
      <BrandFilterSidebar
        totalCount={0}
        categories={[{ slug: "jewelry", name: "Jewelry", nameZh: "飾品珠寶" }]}
      />,
    );

    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("clears categories and dependent subcategories while preserving other state", async () => {
    query = "search=herbs&category=jewelry&sub=earrings&price=2&sort=name";
    const user = userEvent.setup();
    render(
      <BrandFilterSidebar
        totalCount={0}
        categories={[{ slug: "jewelry", name: "Jewelry", nameZh: "飾品珠寶" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear categories" }));

    expect(replace).toHaveBeenCalledWith(
      "/brands?search=herbs&price=2&sort=name",
      { scroll: false },
    );
  });

  describe("subcategory chips", () => {
    it("renders chips under a checked category with counts", () => {
      query = "category=bags-accessories&sub=clasp-frame-bags";
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

    it("removes the sub param when clearing all filters", async () => {
      query = "sub=clasp-frame-bags&sort=name";
      const user = userEvent.setup();
      render(
        <BrandFilterSidebar
          totalCount={0}
          categories={[]}
          subcategories={subs}
          activeSubSlugs={["clasp-frame-bags"]}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Clear all" }));

      expect(replace).toHaveBeenCalledWith("/brands?sort=name", {
        scroll: false,
      });
    });
  });
});
