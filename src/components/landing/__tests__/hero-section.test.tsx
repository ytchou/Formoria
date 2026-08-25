/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ fill: _fill, preload, ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock
    <img alt="" data-preload={preload ? "true" : "false"} {...props} />
  ),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
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

vi.mock("@/components/brands/search-input", () => ({
  SearchInput: (props: Record<string, unknown>) => (
    <div data-testid="search-input" {...props} />
  ),
}));

vi.mock("@/components/ui/photo-band", () => ({
  PhotoBand: ({
    children,
    ...rest
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <section {...rest}>{children}</section>,
}));

vi.mock("@/components/ui/toggle-chip", () => ({
  ChipRow: ({
    children,
    className,
    ...rest
  }: {
    children: ReactNode;
    className?: string;
    [key: string]: unknown;
  }) => (
    <div data-testid="chip-row" className={className} {...rest}>
      {children}
    </div>
  ),
  taxonomyLinkClasses: ({ active, className }: { active?: boolean; className?: string } = {}) =>
    active ? `chip-active${className ? ` ${className}` : ""}` : `chip${className ? ` ${className}` : ""}`,
}));

const HeroSection = (await import("../hero-section")).default;

const mockCategories = [
  { slug: "fashion", name: "Fashion & Apparel", nameZh: "服飾鞋履" },
  { slug: "beauty", name: "Beauty & Personal Care", nameZh: "美妝保養" },
];

describe("HeroSection — centered layout with category chips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a centered h1 with the headline translation key", async () => {
    render(
      await HeroSection({ categories: mockCategories, locale: "zh-TW" }),
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent("headline");
  });

  it("renders the search input", async () => {
    render(
      await HeroSection({ categories: mockCategories, locale: "zh-TW" }),
    );

    expect(screen.getByTestId("search-input")).toBeInTheDocument();
  });

  it("renders category chips inside ChipRow", async () => {
    render(
      await HeroSection({ categories: mockCategories, locale: "zh-TW" }),
    );

    const chipRow = screen.getByTestId("chip-row");
    expect(chipRow).toBeInTheDocument();

    // "全部品牌" chip + 2 category chips = 3 links inside chip-row
    const links = chipRow.querySelectorAll("a");
    expect(links).toHaveLength(3);
  });

  it("first chip '全部品牌' has active styling", async () => {
    render(
      await HeroSection({ categories: mockCategories, locale: "zh-TW" }),
    );

    const chipRow = screen.getByTestId("chip-row");
    const firstLink = chipRow.querySelector("a");
    expect(firstLink).not.toBeNull();
    expect(firstLink!.className).toContain("chip-active");
  });
});
