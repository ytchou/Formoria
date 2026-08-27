/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicBrandCard } from "@/lib/brands/contracts";

vi.mock("@/components/ui/image", () => ({
  SurfaceImage: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock
    <img src={props.src as string} alt={(props.alt as string) || ""} data-testid="brand-image" />
  ),
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

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/analytics", () => ({
  trackCtaClicked: vi.fn(),
}));

vi.mock("@/components/landing/section-band-cta-link", () => ({
  SectionBandCtaLink: ({
    href,
    label,
    className,
  }: {
    href: string;
    label: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {label}
    </a>
  ),
}));

const { default: BrandStrip } = await import("../brand-strip");

const mockBrands = [
  { id: "1", name: "Brand A", slug: "brand-a", logoUrl: "/i/logos/a.webp", heroImageUrl: "/img/a.webp", categorySlug: "home", cityName: null },
  { id: "2", name: "Brand B", slug: "brand-b", logoUrl: "/i/logos/b.webp", heroImageUrl: "/img/b.webp", categorySlug: "kitchen", cityName: null },
  { id: "3", name: "Brand C", slug: "brand-c", logoUrl: null, heroImageUrl: null, categorySlug: "stationery", cityName: null },
  { id: "4", name: "Brand D", slug: "brand-d", logoUrl: null, heroImageUrl: "/img/d.webp", categorySlug: "food", cityName: null },
] as unknown as PublicBrandCard[];

describe("BrandStrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders count headline", async () => {
    render(
      await BrandStrip({ brands: mockBrands, totalCount: 700 }),
    );

    expect(screen.getByText("count")).toBeInTheDocument();
  });

  it("renders logo image when brand has logoUrl", async () => {
    render(
      await BrandStrip({ brands: mockBrands, totalCount: 700 }),
    );

    const images = screen.getAllByTestId("brand-image");
    // Brand A and Brand B have logoUrl
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", "/i/logos/a.webp");
    expect(images[1]).toHaveAttribute("src", "/i/logos/b.webp");
  });

  it("renders initial-letter fallback when brand has no logoUrl", async () => {
    render(
      await BrandStrip({ brands: mockBrands, totalCount: 700 }),
    );

    // Brand C (no logoUrl, no heroImageUrl) and Brand D (heroImageUrl but no logoUrl)
    // both show the letter fallback
    const fallbacks = screen.getAllByText(/^[A-Z]$/);
    // Filter to the ones that are inside the fallback div (aria-hidden parent)
    const letterFallbacks = fallbacks.filter(
      (el) => el.closest("[aria-hidden]") !== null,
    );
    expect(letterFallbacks).toHaveLength(2);
    expect(letterFallbacks[0]).toHaveTextContent("B"); // Brand C
    expect(letterFallbacks[1]).toHaveTextContent("B"); // Brand D
  });

  it("does not fall back to heroImageUrl", async () => {
    // Brand D has heroImageUrl but no logoUrl — should NOT render an image
    const brandsWithHeroOnly = [mockBrands[3]]; // Brand D
    render(
      await BrandStrip({ brands: brandsWithHeroOnly, totalCount: 1 }),
    );

    expect(screen.queryAllByTestId("brand-image")).toHaveLength(0);
    // Should show letter fallback instead
    const fallback = screen.getByText("B");
    expect(fallback.closest("[aria-hidden]")).not.toBeNull();
  });

  it("renders browse-all link", async () => {
    render(
      await BrandStrip({ brands: mockBrands, totalCount: 700 }),
    );

    const link = screen.getByText("browseAll");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/brands");
  });
});
