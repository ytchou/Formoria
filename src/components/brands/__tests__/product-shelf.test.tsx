// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProductRailGroup } from "@/lib/curated-products/brand-rails";
import type { CuratedProduct } from "@/lib/services/curated-products";

// --- Mocks ---

const scrollToMock = vi.fn();
const scrollPrevMock = vi.fn();
const scrollNextMock = vi.fn();
let emblaReInitHandler: (() => void) | undefined;
let canScrollPrevValue = false;
let canScrollNextValue = false;

vi.mock("embla-carousel-react", () => ({
  default: () => {
    const ref = vi.fn();
    const api = {
      scrollTo: scrollToMock,
      scrollPrev: scrollPrevMock,
      scrollNext: scrollNextMock,
      canScrollPrev: () => canScrollPrevValue,
      canScrollNext: () => canScrollNextValue,
      on: (event: string, handler: () => void) => {
        if (event === "reInit") emblaReInitHandler = handler;
        return api;
      },
      off: (_event: string, _handler: () => void) => api,
    };
    return [ref, api];
  },
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock
    <img alt="" {...props} />
  ),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/analytics", () => ({
  trackCuratedProductClicked: vi.fn(),
  trackOutboundClick: vi.fn(),
}));

vi.mock("@/components/ui/save-button", () => ({
  SaveButton: () => <button data-testid="save-button" />,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/taxonomy/ontology", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/lib/taxonomy/ontology")>();
  return {
    ...mod,
    subcategoryDisplayLabel: (slug: string, _locale: string) =>
      slug === "eyewear" ? "Eyewear" : slug === "bags" ? "Bags" : slug,
  };
});

// --- Helpers ---

function makeProduct(overrides: Partial<CuratedProduct> = {}): CuratedProduct {
  return {
    key: "prod-1",
    nameZh: "產品一",
    nameEn: "Product One",
    productDescriptionZh: "描述",
    productDescriptionEn: "Description",
    imageUrl: "https://cdn.example.com/img.jpg",
    officialUrl: "https://example.com/product",
    category: "lifestyle",
    subcategory: "eyewear",
    linkState: null,
    productPosition: 1,
    createdAt: "2026-01-01",
    mitQualified: false,
    ...overrides,
  } as CuratedProduct;
}

function makeGroups(): ProductRailGroup[] {
  return [
    {
      subcategory: "eyewear",
      products: [
        makeProduct({ key: "ew-1", nameEn: "Glasses A" }),
        makeProduct({ key: "ew-2", nameEn: "Glasses B" }),
      ],
    },
    {
      subcategory: "bags",
      products: [makeProduct({ key: "bg-1", nameEn: "Bag A" })],
    },
  ];
}

const defaultProps = {
  allLabel: "All",
  labels: {
    cta: "Visit product",
    brandSiteCta: "Visit brand site",
    unavailable: "Link unavailable",
    madeInTaiwan: "Made in Taiwan",
  },
  locale: "en" as const,
  brand: {
    slug: "test-brand",
    purchaseWebsite: "https://test.com",
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
  },
  heading: "Formoria Selected",
  note: "Our picks from this brand.",
  ariaLabel: "Formoria Selected",
  previousLabel: "Previous products",
  nextLabel: "Next products",
};

// --- Tests ---

// Dynamic import so mocks are registered first.
const { ProductShelf } = await import("../product-shelf");

describe("ProductShelf", () => {
  it("renders all products when All chip is active", () => {
    canScrollPrevValue = false;
    canScrollNextValue = false;

    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);

    // All 3 products rendered
    expect(screen.getByText("Glasses A")).toBeInTheDocument();
    expect(screen.getByText("Glasses B")).toBeInTheDocument();
    expect(screen.getByText("Bag A")).toBeInTheDocument();

    // "All" chip is pressed
    const allChip = screen.getByRole("button", { name: "All" });
    expect(allChip).toHaveAttribute("aria-pressed", "true");
  });

  it("filters products by subcategory on chip click", () => {
    canScrollPrevValue = false;
    canScrollNextValue = false;

    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);

    // Click the "Eyewear" chip
    const eyewearChip = screen.getByRole("button", { name: "Eyewear" });
    fireEvent.click(eyewearChip);

    // Only eyewear products visible
    expect(screen.getByText("Glasses A")).toBeInTheDocument();
    expect(screen.getByText("Glasses B")).toBeInTheDocument();
    expect(screen.queryByText("Bag A")).not.toBeInTheDocument();

    // Eyewear chip pressed, others not
    expect(eyewearChip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("resets carousel scroll on filter change", () => {
    canScrollPrevValue = true;
    canScrollNextValue = true;

    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);

    scrollToMock.mockClear();

    // Click a subcategory chip to trigger filter change
    const eyewearChip = screen.getByRole("button", { name: "Eyewear" });
    fireEvent.click(eyewearChip);

    expect(scrollToMock).toHaveBeenCalledWith(0);
  });

  it("hides controls when no overflow", () => {
    canScrollPrevValue = false;
    canScrollNextValue = false;

    render(
      <ProductShelf
        {...defaultProps}
        groups={[
          {
            subcategory: "eyewear",
            products: [makeProduct({ key: "ew-1" })],
          },
        ]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Previous products" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next products" }),
    ).not.toBeInTheDocument();
  });

  it("renders controls inline with heading when overflow", () => {
    canScrollPrevValue = true;
    canScrollNextValue = true;

    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);

    // Trigger the sync by simulating reInit
    emblaReInitHandler?.();

    // Re-render to pick up state
    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);

    // Controls should be present (the mock sets canScroll* to true)
    expect(
      screen.getByRole("button", { name: "Previous products" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next products" }),
    ).toBeInTheDocument();
  });
});
