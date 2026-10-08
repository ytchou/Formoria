// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";

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

const fadeInSwappedItemsMock = vi.fn();
vi.mock("@/lib/motion/chip-swap", () => ({
  fadeInSwappedItems: (items: NodeListOf<Element>) =>
    fadeInSwappedItemsMock(items),
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
    // Same-origin proxy path: safeImageSrc accepts it, and the shelf renders
    // nothing for a product without a usable photo.
    imageUrl: "/i/curated-products/p/img.jpg",
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

// Four products: past the static-grid ceiling, so the shelf is a carousel.
function makeLargeGroups(): ProductRailGroup[] {
  const [eyewear, bags] = makeGroups();
  return [
    eyewear!,
    {
      ...bags!,
      products: [
        ...bags!.products,
        makeProduct({ key: "bg-2", nameEn: "Bag B" }),
      ],
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

// TrustLabel reads the `trustLabel` namespace, so render through the real
// catalogue rather than a key-echo mock.
function render(ui: ReactNode) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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

    render(<ProductShelf {...defaultProps} groups={makeLargeGroups()} />);

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

    render(<ProductShelf {...defaultProps} groups={makeLargeGroups()} />);

    // Trigger the sync by simulating reInit
    act(() => emblaReInitHandler?.());

    // Re-render to pick up state
    render(<ProductShelf {...defaultProps} groups={makeLargeGroups()} />);

    // Controls should be present (the mock sets canScroll* to true)
    expect(
      screen.getByRole("button", { name: "Previous products" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next products" }),
    ).toBeInTheDocument();
  });

  it("carries no 選物 trust label in the shelf header", () => {
    canScrollPrevValue = false;
    canScrollNextValue = false;

    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Formoria Selected",
    });
    expect(heading.className).toContain("text-balance");
    expect(document.querySelector('[data-trust-label="selected"]')).toBeNull();
  });

  it("shows a tile's trust label only when a guide placed it", () => {
    render(
      <ProductShelf
        {...defaultProps}
        groups={makeGroups()}
        guides={{
          "ew-1": { slug: "reading-corner", title: "Reading corner", locale: "en" },
        }}
      />,
    );

    const labels = document.querySelectorAll('[data-trust-label="selected"]');
    expect(labels).toHaveLength(1);
    expect(labels[0]!.closest("li")?.id).toBe("product-ew-1");
    expect(
      screen.getByRole("link", { name: /Reading corner/ }),
    ).toHaveAttribute("href", "/style/reading-corner");
  });

  it("renders three or fewer products as a static grid, not a carousel", () => {
    canScrollPrevValue = true;
    canScrollNextValue = true;

    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);
    act(() => emblaReInitHandler?.());

    const region = screen.getByRole("region", { name: "Formoria Selected" });
    expect(region).not.toHaveAttribute("aria-roledescription");
    expect(
      screen.queryByRole("button", { name: "Previous products" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next products" }),
    ).not.toBeInTheDocument();
    const list = region.querySelector("ul")!;
    expect(list.className).toContain("grid");
    expect(list.className).toContain("gap-gutter");
  });

  it("keeps the carousel past three products, arrows hidden on phones", () => {
    canScrollPrevValue = true;
    canScrollNextValue = true;

    render(<ProductShelf {...defaultProps} groups={makeLargeGroups()} />);
    act(() => emblaReInitHandler?.());

    const region = screen.getByRole("region", { name: "Formoria Selected" });
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    const arrows = screen.getByRole("button", {
      name: "Previous products",
    }).parentElement!;
    expect(arrows.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["hidden", "sm:flex"]),
    );
  });

  it("hides the chip row when there is only one subcategory", () => {
    render(
      <ProductShelf
        {...defaultProps}
        groups={[makeGroups()[0]!]}
      />,
    );

    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
    expect(screen.getByText("Glasses A")).toBeInTheDocument();
  });

  it("drops a tile whose image fails to load", () => {
    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);

    const image = document.querySelector("#product-ew-1 img")!;
    fireEvent.error(image);

    expect(document.querySelector("#product-ew-1")).toBeNull();
    expect(screen.getByText("Glasses B")).toBeInTheDocument();
  });

  it("renders no list when every image fails", () => {
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

    fireEvent.error(document.querySelector("#product-ew-1 img")!);

    expect(document.querySelector("ul")).toBeNull();
  });

  it("fades the incoming tiles in on a chip swap", () => {
    render(<ProductShelf {...defaultProps} groups={makeGroups()} />);
    fadeInSwappedItemsMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Eyewear" }));

    expect(fadeInSwappedItemsMock).toHaveBeenCalledTimes(1);
    const items = Array.from(
      fadeInSwappedItemsMock.mock.calls[0]![0] as NodeListOf<Element>,
    );
    expect(items.map((el) => el.id)).toEqual(["product-ew-1", "product-ew-2"]);
  });
});
