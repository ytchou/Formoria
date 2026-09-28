/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { searchParams } = vi.hoisted(() => ({
  searchParams: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
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
  beforeEach(() => {
    searchParams.current = new URLSearchParams(
      "sub=candles,ceramics&material=wood",
    );
  });

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

  it("renders a category chip whose remove href drops category and sub but keeps q", () => {
    searchParams.current = new URLSearchParams(
      "q=%E6%90%AC%E5%AE%B6&category=home&sub=candles",
    );
    render(
      <ProductActiveFilters
        activeFilters={[{ type: "category", slug: "home", label: "Home" }]}
        query="搬家"
      />,
    );

    const chip = screen
      .getAllByRole("link")
      .find((link) => link.textContent?.includes("Home"));
    expect(chip).toBeDefined();
    expect(chip!.textContent).toContain("category:");
    const params = new URLSearchParams(chip!.getAttribute("href")!.split("?")[1]);
    expect(params.get("category")).toBeNull();
    expect(params.get("sub")).toBeNull();
    expect(params.get("q")).toBe("搬家");
  });

  it("inferred chips carry the 自動判斷 badge; manual chips do not", () => {
    searchParams.current = new URLSearchParams(
      "q=x&sub=candles&material=metal&inferred=material",
    );
    render(
      <ProductActiveFilters
        activeFilters={[
          { type: "subcategory", slug: "candles", label: "Candles" },
          { type: "material", slug: "metal", label: "Metal" },
        ]}
        query="x"
      />,
    );

    const metal = screen
      .getAllByRole("link")
      .find((link) => link.textContent?.includes("Metal"))!;
    const candles = screen
      .getAllByRole("link")
      .find((link) => link.textContent?.includes("Candles"))!;
    expect(metal.textContent).toContain("inferred");
    expect(metal.getAttribute("aria-label")).toContain("（inferred）");
    expect(candles.textContent).not.toContain("inferred");
    expect(candles.getAttribute("aria-label")).not.toContain("inferred");
  });

  it("clear-all in search mode drops q, category, sub, material and inferred", () => {
    searchParams.current = new URLSearchParams(
      "q=x&category=home&sub=candles&material=metal&inferred=category,material&sort=newest",
    );
    render(
      <ProductActiveFilters
        activeFilters={[
          { type: "category", slug: "home", label: "Home" },
          { type: "material", slug: "metal", label: "Metal" },
        ]}
        query="x"
      />,
    );

    const href = screen.getByText("clearAll").closest("a")!.getAttribute("href")!;
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    for (const key of ["q", "category", "sub", "material", "inferred"]) {
      expect(params.get(key)).toBeNull();
    }
    expect(params.get("sort")).toBe("newest");
  });

  it("clear-all in browse mode keeps category", () => {
    searchParams.current = new URLSearchParams(
      "category=home&sub=candles&material=wood",
    );
    render(
      <ProductActiveFilters
        activeFilters={[
          { type: "subcategory", slug: "candles", label: "Candles" },
          { type: "material", slug: "wood", label: "Wood" },
        ]}
      />,
    );

    const href = screen.getByText("clearAll").closest("a")!.getAttribute("href")!;
    expect(href).toBe("/discover?category=home");
  });

  it("test_active_filters_hidden_when_empty", () => {
    const { container } = render(
      <ProductActiveFilters activeFilters={[]} />,
    );

    expect(container.innerHTML).toBe("");
  });
});
