/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";

const { replace, push, searchParams, trackSubcategory } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  searchParams: { current: new URLSearchParams() },
  trackSubcategory: vi.fn(),
}));

vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  trackProductSubcategoryFilterApplied: trackSubcategory,
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/discover",
  useRouter: () => ({ push, replace }),
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
  useSearchParams: () => searchParams.current,
  usePathname: () => "/discover",
  useRouter: () => ({ push, replace }),
}));

const { ProductFilterSidebar, ProductFilterDrawer } = await import(
  "../product-filter-sidebar"
);

function renderSidebar(
  props: Partial<React.ComponentProps<typeof ProductFilterSidebar>> = {},
  query = "",
) {
  searchParams.current = new URLSearchParams(query);
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ProductFilterSidebar
        locale="en"
        activeCategory={null}
        allLabel="All"
        totalCount={10}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

function filterGroup(name: string) {
  return screen.getByRole("group", { name });
}

describe("ProductFilterSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders L1 category links with aria-current on active", () => {
    renderSidebar({ activeCategory: "home" });

    // "All" link is not active
    const allLink = screen.getByRole("link", { name: "All" });
    expect(allLink).not.toHaveAttribute("aria-current");

    // There should be multiple category links
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(1);

    // The active category link has aria-current="page"
    const homeLink = links.find(
      (link) => link.getAttribute("aria-current") === "page",
    );
    expect(homeLink).toBeDefined();
  });

  it("renders subcategory checkboxes when category is active", () => {
    renderSidebar({
      activeCategory: "home",
      subcategoryOptions: [
        { slug: "candles", label: "Candles", count: 5 },
        { slug: "decor", label: "Decor", count: 3 },
      ],
      activeSubSlugs: [],
    });

    const panel = filterGroup("Subcategory");
    const checkboxes = within(panel).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(
      within(panel).getByRole("checkbox", { name: /Candles/ }),
    ).toBeInTheDocument();
  });

  it("renders the subcategory section with no active category when options exist", () => {
    renderSidebar({
      activeCategory: null,
      subcategoryOptions: [
        { slug: "candles", label: "Candles", count: 5, category: "home" },
        { slug: "tea", label: "Tea", count: 4, category: "food" },
      ],
    });

    const panel = filterGroup("Subcategory");
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(2);
  });

  it("hides the subcategory section when there are no options", () => {
    renderSidebar({ activeCategory: null, subcategoryOptions: [] });

    expect(
      screen.queryByRole("group", { name: "Subcategory" }),
    ).not.toBeInTheDocument();
  });

  it("checking a subcategory under All sets its parent category and the sub together, dropping material", () => {
    renderSidebar(
      {
        activeCategory: null,
        subcategoryOptions: [
          { slug: "candles", label: "Candles", count: 5, category: "home" },
        ],
      },
      "material=wood",
    );

    fireEvent.click(
      within(filterGroup("Subcategory")).getByRole("checkbox", {
        name: /Candles/,
      }),
    );

    const target = replace.mock.calls.at(-1)?.[0] as string;
    const params = new URL(target, "http://localhost").searchParams;
    expect(params.get("category")).toBe("home");
    expect(params.get("sub")).toBe("candles");
    // Same as a category link: the new L1 may not offer the material facet,
    // so keeping it would filter by a group the sidebar no longer shows.
    expect(params.get("material")).toBeNull();
    expect(trackSubcategory).toHaveBeenCalledWith("candles", "home", 5);
  });

  it("checking a subcategory inside a category reports that category", () => {
    renderSidebar({
      activeCategory: "home",
      subcategoryOptions: [
        { slug: "candles", label: "Candles", count: 5, category: "home" },
      ],
    });

    fireEvent.click(
      within(filterGroup("Subcategory")).getByRole("checkbox", {
        name: /Candles/,
      }),
    );
    expect(trackSubcategory).toHaveBeenCalledWith("candles", "home", 5);
  });

  it("category rows show counts, with All as the total, outside the link name", () => {
    renderSidebar({
      activeCategory: "home",
      // `tech` is a deferred (hidden) L1: it has no row, so All excludes it.
      categoryCounts: { home: 7, fashion: 3, tech: 5 },
    });

    const all = screen.getByRole("link", { name: "All" });
    expect(all).toHaveTextContent("10");
    expect(all).not.toHaveTextContent("15");
    expect(all).not.toHaveAttribute("aria-current");

    const active = screen
      .getAllByRole("link")
      .find((link) => link.getAttribute("aria-current") === "page")!;
    expect(active).toHaveAttribute("href", "/discover?category=home");
    expect(active).toHaveTextContent("7");
    // The count is aria-hidden, so the name stays the label alone (the exact
    // "All" match above depends on it).
    expect(
      within(active).getByText("7"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("category rows render no counts when categoryCounts is absent", () => {
    renderSidebar({ activeCategory: null });

    const all = screen.getByRole("link", { name: "All" });
    expect(all).toHaveAttribute("aria-current", "page");
    expect(all).toHaveTextContent(/^All$/);
  });

  it("omits the category group when showCategories is off, keeping subcategory and material", () => {
    renderSidebar({
      showCategories: false,
      subcategoryOptions: [
        { slug: "candles", label: "Candles", count: 5, category: "home" },
      ],
      materialOptions: [{ value: "wood", label: "Wood", count: 8 }],
    });

    expect(
      screen.queryByRole("group", { name: "Category" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(filterGroup("Subcategory")).toBeInTheDocument();
    expect(filterGroup("Material")).toBeInTheDocument();
  });

  it("hideCounts keeps the subcategory and material labels but drops their catalog-wide counts", () => {
    renderSidebar({
      hideCounts: true,
      subcategoryOptions: [
        { slug: "candles", label: "Candles", count: 5, category: "home" },
      ],
      materialOptions: [{ value: "wood", label: "Wood", count: 8 }],
    });

    const subs = filterGroup("Subcategory");
    expect(within(subs).getByRole("checkbox", { name: /Candles/ })).toBeInTheDocument();
    expect(within(subs).queryByText("5")).not.toBeInTheDocument();
    const materials = filterGroup("Material");
    expect(within(materials).getByRole("checkbox", { name: /Wood/ })).toBeInTheDocument();
    expect(within(materials).queryByText("8")).not.toBeInTheDocument();
  });

  it("renders material checkboxes", () => {
    renderSidebar({
      materialOptions: [
        { value: "ceramic", label: "Ceramic", count: 12 },
        { value: "wood", label: "Wood", count: 8 },
      ],
      activeMaterials: [],
    });

    const panel = filterGroup("Material");
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(2);
    expect(
      within(panel).getByRole("checkbox", { name: /Ceramic/ }),
    ).toBeInTheDocument();
  });

  it("toggles subcategory and updates URL", () => {
    renderSidebar({
      activeCategory: "home",
      subcategoryOptions: [
        { slug: "candles", label: "Candles", count: 5 },
      ],
      activeSubSlugs: [],
    });

    fireEvent.click(
      within(filterGroup("Subcategory")).getByRole("checkbox", {
        name: /Candles/,
      }),
    );
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("sub=candles"),
      { scroll: false },
    );
  });

  it("toggles material and updates URL", () => {
    renderSidebar({
      materialOptions: [
        { value: "ceramic", label: "Ceramic", count: 12 },
      ],
      activeMaterials: [],
    });

    fireEvent.click(
      within(filterGroup("Material")).getByRole("checkbox", {
        name: /Ceramic/,
      }),
    );
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("material=ceramic"),
      { scroll: false },
    );
  });

  it("category links keep q in search mode", () => {
    renderSidebar({ activeCategory: "home" }, "q=%E6%90%AC%E5%AE%B6&category=home");

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")!);
    expect(hrefs).toContain(`/discover?q=${encodeURIComponent("搬家")}`);
    const categoryHrefs = hrefs.filter((href) => href.includes("category="));
    expect(categoryHrefs.length).toBeGreaterThan(0);
    for (const href of categoryHrefs) {
      expect(new URLSearchParams(href.split("?")[1]).get("q")).toBe("搬家");
    }
  });

  it("category links are unchanged in browse mode", () => {
    renderSidebar({ activeCategory: "home" }, "category=home&material=wood");

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")!);
    expect(hrefs).toContain("/discover");
    expect(hrefs).toContain("/discover?category=home");
    expect(hrefs.every((href) => !href.includes("q="))).toBe(true);
  });

  it("drawer clear-all in search mode drops q, category and inferred", () => {
    searchParams.current = new URLSearchParams(
      "q=x&category=home&sub=candles&material=metal&inferred=category,material&sort=newest",
    );
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProductFilterDrawer
          locale="en"
          activeCategory="home"
          allLabel="All"
          totalCount={10}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(replace).toHaveBeenCalledWith("/discover?sort=newest", {
      scroll: false,
    });
  });

  it("drawer clear-all in browse mode keeps category", () => {
    searchParams.current = new URLSearchParams(
      "category=home&sub=candles&material=wood",
    );
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProductFilterDrawer
          locale="en"
          activeCategory="home"
          allLabel="All"
          totalCount={10}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(replace).toHaveBeenCalledWith("/discover?category=home", {
      scroll: false,
    });
  });

  it("drawer clear-all with a whitespace-only q keeps category", () => {
    searchParams.current = new URLSearchParams(
      "q=%20&category=home&sub=candles&material=wood",
    );
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProductFilterDrawer
          locale="en"
          activeCategory="home"
          allLabel="All"
          totalCount={10}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const target = replace.mock.calls.at(-1)?.[0] as string;
    expect(new URL(target, "http://localhost").searchParams.get("category")).toBe(
      "home",
    );
  });

  it("drawer renders with trigger button", () => {
    searchParams.current = new URLSearchParams();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProductFilterDrawer
          locale="en"
          activeCategory={null}
          allLabel="All"
          totalCount={10}
        />
      </NextIntlClientProvider>,
    );

    // The trigger button from FilterDrawerShell
    const trigger = screen.getByRole("button", { name: /^Filters/ });
    expect(trigger).toBeInTheDocument();
  });
});
