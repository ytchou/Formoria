// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { WallSlot } from "@/lib/curated-products/home-wall";
import type { HomepageCuratedProduct } from "@/lib/services/curated-products";

vi.mock("@/components/ui/photo-band", () => ({
  PhotoBand: ({
    children,
    ...rest
  }: { children: ReactNode } & Record<string, unknown>) => (
    <section {...rest}>{children}</section>
  ),
}));

vi.mock("@/components/ui/grid", () => ({
  Grid: ({
    children,
    as: As = "div",
  }: {
    children: ReactNode;
    as?: string;
    cols?: string;
    className?: string;
  }) => {
    const El = As as keyof HTMLElementTagNameMap;
    return <El data-testid="grid">{children}</El>;
  },
}));

vi.mock("@/components/brands/selected-product-tile", () => ({
  SelectedProductTile: ({
    product,
  }: {
    product: HomepageCuratedProduct;
  }) => <div data-testid={`product-${product.id}`}>{product.nameZh}</div>,
}));

vi.mock("@/components/analytics/view-item-list-tracker", () => ({
  ViewItemListTracker: ({
    listName,
    itemCount,
  }: {
    listName: string;
    itemCount: number;
  }) => (
    <div
      data-testid="tracker"
      data-list-name={listName}
      data-item-count={itemCount}
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

vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

const FIXTURES = [
  { nameZh: "手沖壺", brandName: "小器生活" },
  { nameZh: "麻布長桌巾", brandName: "本嶼織物" },
  { nameZh: "陶土馬克杯", brandName: "土屋陶作" },
  { nameZh: "黃銅書籤", brandName: "日星鑄字" },
  { nameZh: "無染色棉質浴巾", brandName: "禾織" },
  { nameZh: "花器", brandName: "三生" },
  { nameZh: "便當盒", brandName: "里山" },
  { nameZh: "帆布袋", brandName: "鹿回" },
];

function buildProduct(index: number): HomepageCuratedProduct {
  const fixture = FIXTURES[index % FIXTURES.length]!;
  return {
    id: `product-${index}`,
    brandId: `brand-${index}`,
    key: `product-${index}`,
    nameZh: fixture.nameZh,
    nameEn: null,
    category: "home",
    subcategories: [],
    mitQualified: false,
    officialUrl: "https://example.com/product",
    imageUrl: `/i/curated-products/p/${index}.jpg`,
    imageSourceUrl: null,
    visible: true,
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: null,
    reviewDueAt: null,
    productDescriptionZh: "描述",
    productDescriptionEn: null,
    productPosition: null,
    createdAt: "2026-01-01T00:00:00Z",
    trailSlug: null,
    sectionKey: null,
    position: 0,
    imageWidth: 1200,
    imageHeight: 900,
    brandSlug: `brand-${index}`,
    brandName: fixture.brandName,
    brand: {
      slug: `brand-${index}`,
      purchaseWebsite: "https://example.com",
      purchasePinkoi: null,
      purchaseShopee: null,
      purchaseMyship: null,
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
    },
  };
}

function productSlots(count: number): WallSlot[] {
  return Array.from({ length: count }, (_, index) => ({
    product: buildProduct(index),
    ratio: "4:3" as const,
  }));
}

// CuratedProductGrid is async (server component), so we await it.
async function renderGrid(slots: WallSlot[]) {
  const { CuratedProductGrid } = await import("../curated-product-grid");
  const jsx = await CuratedProductGrid({ slots, locale: "zh-TW" });
  return render(jsx);
}

describe("CuratedProductGrid", () => {
  it("renders grid with products", async () => {
    const slots = productSlots(8);
    await renderGrid(slots);

    for (let i = 0; i < 8; i++) {
      expect(screen.getByTestId(`product-${slots[i]!.product.id}`)).toBeInTheDocument();
    }
  });

  it("renders cta button linking to discover", async () => {
    await renderGrid(productSlots(4));

    const cta = screen.getByText("selection.cta");
    expect(cta.closest("a")).toHaveAttribute("href", "/discover");
  });

  it("includes view item list tracker", async () => {
    await renderGrid(productSlots(4));

    const tracker = screen.getByTestId("tracker");
    expect(tracker).toHaveAttribute("data-list-name", "homepage_wall");
  });

  it("slices to two complete desktop rows", async () => {
    const slots = productSlots(12);
    await renderGrid(slots);

    for (let i = 0; i < 10; i++) {
      expect(screen.getByTestId(`product-${slots[i]!.product.id}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId(`product-${slots[10]!.product.id}`)).toBeNull();
  });
});
