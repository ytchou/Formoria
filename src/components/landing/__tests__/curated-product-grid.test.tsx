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
  // `className` is passed through: the phone two-up and the lg five-up are
  // both added at the call site, so they are what the grid tests below read.
  Grid: ({
    children,
    as: As = "div",
    className,
  }: {
    children: ReactNode;
    as?: string;
    cols?: string;
    className?: string;
  }) => {
    const El = As as keyof HTMLElementTagNameMap;
    return (
      <El data-testid="grid" className={className}>
        {children}
      </El>
    );
  },
}));

vi.mock("@/components/brands/selected-product-tile", () => ({
  SelectedProductTile: ({
    product,
    className,
  }: {
    product: HomepageCuratedProduct;
    className?: string;
  }) => (
    <div data-testid={`product-${product.id}`} className={className}>
      {product.nameZh}
    </div>
  ),
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

vi.mock("@/components/landing/category-filter", () => ({
  CategoryFilter: ({
    children,
    labels,
  }: {
    children: ReactNode;
    labels: { loading: string; loadFailed: string; retry: string };
  }) => (
    <div
      data-testid="category-filter"
      data-loading={labels.loading}
      data-load-failed={labels.loadFailed}
      data-retry={labels.retry}
    >
      {children}
    </div>
  ),
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
    subcategory: "tableware",
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
      expect(
        screen.getByTestId(`product-${slots[i]!.product.id}`),
      ).toBeInTheDocument();
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

  it("renders a category filter", async () => {
    await renderGrid(productSlots(4));

    expect(screen.getByTestId("category-filter")).toBeInTheDocument();
  });

  // Bug caught: a single phone column of ten tiles made the band ~4,300px tall
  // and buried the trails and stories below it.
  it("lays the band out two-up on phones and five-up from lg", async () => {
    await renderGrid(productSlots(10));

    const grid = screen.getByTestId("grid");
    expect(grid).toHaveClass("grid-cols-2");
    expect(grid).toHaveClass("lg:grid-cols-5");
    // The phone gap is the gutter token halved, never a numeric step.
    expect(grid).toHaveClass("max-sm:gap-[calc(var(--space-gutter)/2)]");
  });

  it("hides every tile past the sixth on phones, by class rather than slice", async () => {
    const slots = productSlots(10);
    await renderGrid(slots);

    for (const [index, slot] of slots.entries()) {
      const tile = screen.getByTestId(`product-${slot.product.id}`);
      // Every tile is still in the server HTML; only phones drop the tail.
      expect(tile).toHaveClass("bg-ground");
      if (index < 6) {
        expect(tile).not.toHaveClass("max-sm:hidden");
      } else {
        expect(tile).toHaveClass("max-sm:hidden");
      }
    }
  });

  // DEV-1972: the six category groups left the server HTML; a chip fetches
  // its group on click. Only the "all" group ships, still at the selector
  // `e2e/tests/homepage-bands.spec.ts` pins.
  it("server-renders only the all group", async () => {
    const slots = productSlots(10);
    const { container } = await renderGrid(slots);

    const groups = container.querySelectorAll("[data-category]");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAttribute("data-category", "all");
    expect(groups[0]).not.toHaveAttribute("hidden");
    expect(
      container.querySelectorAll('[data-category="all"] > ul > *'),
    ).toHaveLength(10);
  });

  it("counts the all group in the view item list tracker", async () => {
    await renderGrid(productSlots(7));

    expect(screen.getByTestId("tracker")).toHaveAttribute(
      "data-item-count",
      "7",
    );
  });

  it("hands the client filter its loading, failure and retry copy", async () => {
    await renderGrid(productSlots(4));

    const filter = screen.getByTestId("category-filter");
    expect(filter).toHaveAttribute("data-loading", "selection.loading");
    expect(filter).toHaveAttribute("data-load-failed", "selection.loadFailed");
    expect(filter).toHaveAttribute("data-retry", "retry");
  });
});

describe("WallGroupGrid", () => {
  async function renderGroup(slug: string, slots: WallSlot[]) {
    const { WallGroupGrid } = await import("../wall-group-grid");
    return render(
      <WallGroupGrid
        slug={slug}
        slots={slots}
        locale="zh-TW"
        labels={{ cta: "cta", brandSiteCta: "site", unavailable: "gone" }}
      />,
    );
  }

  it("applies the phone cap inside every group, not only all", async () => {
    const slots = productSlots(8);
    const { container } = await renderGroup("home", slots);

    const homeTiles = slots.map((slot) =>
      screen
        .getAllByTestId(`product-${slot.product.id}`)
        .find((node) => node.closest('[data-category="home"]')),
    );
    expect(container.querySelector('[data-category="home"]')).not.toBeNull();
    expect(homeTiles[5]).not.toHaveClass("max-sm:hidden");
    expect(homeTiles[6]).toHaveClass("max-sm:hidden");
    expect(homeTiles[7]).toHaveClass("max-sm:hidden");
  });

  it("renders an empty grid for an empty group", async () => {
    const { container } = await renderGroup("jewelry", []);

    const group = container.querySelector('[data-category="jewelry"]');
    expect(group?.querySelector("ul")).not.toBeNull();
    expect(group?.querySelectorAll("li")).toHaveLength(0);
  });
});
