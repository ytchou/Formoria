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
  { id: "1", name: "Brand A", slug: "brand-a", heroImageUrl: "/img/a.webp", categorySlug: "home", cityName: null },
  { id: "2", name: "Brand B", slug: "brand-b", heroImageUrl: "/img/b.webp", categorySlug: "kitchen", cityName: null },
  { id: "3", name: "Brand C", slug: "brand-c", heroImageUrl: null, categorySlug: "stationery", cityName: null },
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

  it("renders brand cards with images", async () => {
    render(
      await BrandStrip({ brands: mockBrands, totalCount: 700 }),
    );

    const images = screen.getAllByTestId("brand-image");
    // Brand A and Brand B have images; Brand C has none
    expect(images).toHaveLength(2);
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
