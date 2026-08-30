/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";

const { replace, push, searchParams } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  searchParams: { current: new URLSearchParams() },
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

function sectionButton(name: string) {
  return screen.getByRole("button", { name });
}

function sectionPanel(name: string) {
  const id = sectionButton(name).getAttribute("aria-controls") ?? "";
  const panel = document.getElementById(id);
  if (!panel) throw new Error(`panel for "${name}" has no aria-controls target`);
  return panel;
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

    fireEvent.click(sectionButton("Subcategory"));
    const panel = sectionPanel("Subcategory");
    const checkboxes = within(panel).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(
      within(panel).getByRole("checkbox", { name: /Candles/ }),
    ).toBeInTheDocument();
  });

  it("hides subcategory section when no category is active", () => {
    renderSidebar({
      activeCategory: null,
      subcategoryOptions: [
        { slug: "candles", label: "Candles", count: 5 },
      ],
    });

    expect(
      screen.queryByRole("button", { name: "Subcategory" }),
    ).not.toBeInTheDocument();
  });

  it("renders material checkboxes", () => {
    renderSidebar({
      materialOptions: [
        { value: "ceramic", label: "Ceramic", count: 12 },
        { value: "wood", label: "Wood", count: 8 },
      ],
      activeMaterials: [],
    });

    fireEvent.click(sectionButton("Material"));
    const panel = sectionPanel("Material");
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

    fireEvent.click(sectionButton("Subcategory"));
    fireEvent.click(
      within(sectionPanel("Subcategory")).getByRole("checkbox", {
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

    fireEvent.click(sectionButton("Material"));
    fireEvent.click(
      within(sectionPanel("Material")).getByRole("checkbox", {
        name: /Ceramic/,
      }),
    );
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("material=ceramic"),
      { scroll: false },
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
