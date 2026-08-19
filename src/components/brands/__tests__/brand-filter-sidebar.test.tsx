/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import zhMessages from "../../../../messages/zh-TW.json";

const { replace, push, searchParams } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  searchParams: { current: new URLSearchParams() },
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/brands",
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

// `SearchInput` reaches for the un-localized router through `useFilterParams`.
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
  usePathname: () => "/brands",
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/lib/analytics", () => ({
  trackCategoryFilterApplied: vi.fn(),
  trackFilterCleared: vi.fn(),
  trackPriceFilterApplied: vi.fn(),
  trackSubcategoryFilterApplied: vi.fn(),
  trackVerificationFilterApplied: vi.fn(),
}));

const { BrandFilterSidebar } = await import("../brand-filter-sidebar");

const CATEGORIES = [
  { slug: "home", name: "Home & Living", nameZh: "居家生活" },
  { slug: "fashion", name: "Fashion", nameZh: "時尚服飾" },
];

const MATERIALS = [
  { value: "陶瓷", label: "陶瓷", count: 29 },
  { value: "木", label: "木", count: 12 },
];

function renderSidebar(
  props: Partial<React.ComponentProps<typeof BrandFilterSidebar>> = {},
  query = "",
) {
  searchParams.current = new URLSearchParams(query);
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      <BrandFilterSidebar
        categories={CATEGORIES}
        materials={MATERIALS}
        totalCount={24}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

function materialSection() {
  return screen.getByRole("button", {
    name: zhMessages.brands.filters.material,
  });
}

function materialPanel() {
  const id = materialSection().getAttribute("aria-controls") ?? "";
  const panel = document.getElementById(id);
  if (!panel) throw new Error("material panel has no aria-controls target");
  return panel;
}

describe("BrandFilterSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores a material term the server already rejected", () => {
    // `parseDirectoryViewFilters` drops anything outside the closed 12-term
    // vocabulary, so `activeMaterials` is empty here on purpose. Reading the
    // raw param back would tick nothing yet keep `xyz` in every URL the
    // sidebar writes.
    renderSidebar({ activeMaterials: [] }, "material=xyz");

    fireEvent.click(materialSection());
    for (const box of within(materialPanel()).getAllByRole("checkbox")) {
      expect(box).not.toBeChecked();
    }

    fireEvent.click(
      within(materialPanel()).getByRole("checkbox", { name: /陶瓷/ }),
    );
    expect(replace).toHaveBeenCalledWith("/brands?material=%E9%99%B6%E7%93%B7", {
      scroll: false,
    });
  });

  it("clears the material key entirely when the last term is unticked", () => {
    // The bug this pins: with a rejected term surviving in the set, unticking
    // rewrote `?material=xyz` instead of deleting the key, so the facet could
    // not be cleared at all and the page stayed noindex.
    renderSidebar({ activeMaterials: ["陶瓷"] }, "material=%E9%99%B6%E7%93%B7");

    fireEvent.click(
      within(materialPanel()).getByRole("checkbox", { name: /陶瓷/ }),
    );
    expect(replace).toHaveBeenCalledWith("/brands", { scroll: false });
  });

  it("takes a collapsed section out of the tab order without hiding its markup", () => {
    renderSidebar();

    // Closed by default with no active material: `grid-rows-[0fr]` hides it
    // visually and nothing else, so its checkboxes stayed tabbable and in the
    // accessibility tree. `inert` closes both; the markup stays in the server
    // HTML that crawlers read (DESIGN.md §6).
    expect(materialSection()).toHaveAttribute("aria-expanded", "false");
    expect(materialPanel()).toHaveAttribute("inert");
    expect(materialPanel().textContent).toContain("陶瓷");

    fireEvent.click(materialSection());
    expect(materialSection()).toHaveAttribute("aria-expanded", "true");
    expect(materialPanel()).not.toHaveAttribute("inert");
  });

  it("names each category checkbox from its visible label alone", () => {
    renderSidebar({ activeCategorySlugs: ["home"] });

    const box = screen.getByRole("checkbox", { name: "居家生活" });
    // An aria-label would outrank the visible text and make the accessible
    // name immune to it.
    expect(box).not.toHaveAttribute("aria-label");
  });
});
