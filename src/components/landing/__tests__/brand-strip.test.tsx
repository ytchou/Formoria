/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicBrandCard } from "@/lib/brands/contracts";

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), null],
}));

vi.mock("embla-carousel-auto-scroll", () => ({
  default: () => ({}),
}));

vi.mock("@/components/ui/image", () => ({
  SurfaceImage: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- mock
    <img
      src={props.src as string}
      alt={(props.alt as string) || ""}
      className={props.className as string}
      data-testid="brand-image"
    />
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
  {
    id: "1",
    name: "Brand A",
    slug: "brand-a",
    heroImageUrl: "/img/a.webp",
    categorySlug: "home",
    cityName: null,
  },
  {
    id: "2",
    name: "Brand B",
    slug: "brand-b",
    heroImageUrl: "/img/b.webp",
    categorySlug: "kitchen",
    cityName: null,
  },
  {
    id: "3",
    name: "Brand C",
    slug: "brand-c",
    heroImageUrl: null,
    categorySlug: "stationery",
    cityName: null,
  },
  {
    id: "4",
    name: "Brand D",
    slug: "brand-d",
    heroImageUrl: "/img/d.webp",
    categorySlug: "food",
    cityName: null,
  },
] as unknown as PublicBrandCard[];

describe("BrandStrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders count headline", async () => {
    render(await BrandStrip({ brands: mockBrands, totalCount: 700 }));

    expect(screen.getByText("count")).toBeInTheDocument();
  });

  it("renders hero image for brands with heroImageUrl", async () => {
    render(await BrandStrip({ brands: mockBrands, totalCount: 700 }));

    const images = screen.getAllByTestId("brand-image");
    expect(images).toHaveLength(3);
    expect(images[0]).toHaveAttribute("src", "/img/a.webp");
    expect(images[0]).toHaveAttribute(
      "class",
      expect.stringContaining("rounded-full"),
    );
    expect(images[1]).toHaveAttribute("src", "/img/b.webp");
    expect(images[2]).toHaveAttribute("src", "/img/d.webp");
  });

  it("does not render image when brand has no heroImageUrl", async () => {
    const brandsWithoutHero = [mockBrands[2]];
    render(await BrandStrip({ brands: brandsWithoutHero, totalCount: 1 }));

    expect(screen.queryByTestId("brand-image")).not.toBeInTheDocument();
  });

  it("renders initial-letter fallback when brand has no heroImageUrl", async () => {
    render(await BrandStrip({ brands: mockBrands, totalCount: 700 }));

    const fallbacks = screen.getAllByText(/^[A-Z]$/);
    const letterFallbacks = fallbacks.filter(
      (el) => el.closest("[aria-hidden]") !== null,
    );
    expect(letterFallbacks).toHaveLength(1);
    expect(letterFallbacks[0]).toHaveTextContent("B");
  });

  it("renders all brands as list items in the marquee", async () => {
    render(await BrandStrip({ brands: mockBrands, totalCount: 700 }));

    expect(screen.getAllByRole("listitem")).toHaveLength(mockBrands.length);
    expect(screen.getAllByRole("link")).toHaveLength(mockBrands.length + 1);
  });

  it("renders browse-all link", async () => {
    render(await BrandStrip({ brands: mockBrands, totalCount: 700 }));

    const link = screen.getByText("browseAll");
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute("href", "/brands");
  });
});
