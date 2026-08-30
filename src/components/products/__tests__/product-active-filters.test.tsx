/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/discover",
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("sub=candles,ceramics&material=wood"),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    if (params) return `${key}(${JSON.stringify(params)})`;
    return key;
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ProductActiveFilters } = await import("../product-active-filters");

describe("ProductActiveFilters", () => {
  it("test_active_filters_renders_chips", () => {
    render(
      <ProductActiveFilters
        activeFilters={[
          { type: "subcategory", slug: "candles", label: "Candles" },
          { type: "material", slug: "wood", label: "Wood" },
        ]}
      />,
    );

    const links = screen.getAllByRole("link");
    // 2 chips + 1 "clear all"
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Candles")).toBeInTheDocument();
    expect(screen.getByText("Wood")).toBeInTheDocument();
  });

  it("test_active_filters_dismiss_removes_filter", () => {
    render(
      <ProductActiveFilters
        activeFilters={[
          { type: "subcategory", slug: "candles", label: "Candles" },
          { type: "subcategory", slug: "ceramics", label: "Ceramics" },
        ]}
      />,
    );

    // Find the chip for "Candles" — its href should remove candles but keep ceramics
    const candlesChip = screen.getAllByRole("link").find((link) =>
      link.textContent?.includes("Candles"),
    );
    expect(candlesChip).toBeDefined();
    const href = candlesChip!.getAttribute("href")!;
    // Should keep ceramics in sub param but not candles
    expect(href).toContain("sub=ceramics");
    expect(href).not.toContain("candles");
  });

  it("test_active_filters_clear_all", () => {
    render(
      <ProductActiveFilters
        activeFilters={[
          { type: "subcategory", slug: "candles", label: "Candles" },
          { type: "material", slug: "wood", label: "Wood" },
        ]}
      />,
    );

    const clearAllLink = screen.getByText("clearAll");
    expect(clearAllLink).toBeInTheDocument();
    const href = clearAllLink.closest("a")!.getAttribute("href")!;
    // clearDirectoryFilters removes sub, material, and category
    expect(href).not.toContain("sub=");
    expect(href).not.toContain("material=");
  });

  it("test_active_filters_hidden_when_empty", () => {
    const { container } = render(
      <ProductActiveFilters activeFilters={[]} />,
    );

    expect(container.innerHTML).toBe("");
  });
});
