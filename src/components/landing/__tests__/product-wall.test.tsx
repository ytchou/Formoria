// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { WallSlot } from "@/lib/curated-products/home-wall";
import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";
import {
  ProductWall,
  WALL_MOBILE_VISIBLE_COUNT,
  wallRowSpan,
} from "../product-wall";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    ...props
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
  }: Record<string, unknown>) => <img alt="" {...props} />,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    prefetch: _prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/analytics", () => ({
  trackCuratedProductClicked: vi.fn(),
  trackTrailCardClicked: vi.fn(),
  trackHeroCategoryClicked: vi.fn(),
  trackViewItemList: vi.fn(),
  trackStockistListViewed: vi.fn(),
}));

const labels = {
  heading: "Formoria selections",
  note: "Chosen for a situation, with the reason stated.",
  showMore: "See more selections",
  continuationHeading: "Keep exploring",
  trailLinksLabel: "Other trails",
  categoryLinksLabel: "By category",
  brandsLink: "Explore every brand",
  product: {
    cta: "Visit product",
    brandSiteCta: "Visit brand site",
    selectedBadge: "Formoria selection",
    brandProvidedBadge: "Brand provided",
    unavailable: "Link unavailable",
  },
  trail: { eyebrow: "Trail", cta: "Explore this trail" },
};

function buildProduct(index: number): HomepageCuratedProduct {
  return {
    id: `product-${index}`,
    brandId: `brand-${index}`,
    key: `product-${index}`,
    nameZh: `產品 ${index}`,
    nameEn: `Product ${index}`,
    l1: "home",
    l2: [],
    officialUrl: "https://example.com/product",
    imageUrl: `https://project.supabase.co/storage/v1/object/public/p/${index}.jpg`,
    imageSourceUrl: null,
    imageUsage: "permitted",
    lifecycle: "active",
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: null,
    reviewDueAt: null,
    notesZh: null,
    notesEn: null,
    highlightPosition: null,
    highlightRationaleZh: null,
    highlightRationaleEn: null,
    wallPosition: null,
    createdAt: "2026-01-01T00:00:00Z",
    trailSlug: null,
    sectionKey: null,
    position: 0,
    rationaleZh: `理由 ${index}`,
    rationaleEn: `Reason ${index}`,
    imageWidth: 1200,
    imageHeight: 900,
    brandSlug: `brand-${index}`,
    brandName: `Brand ${index}`,
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

function buildTrail(slug = "small-space-reading-corner"): TrailEntry {
  return {
    slug,
    frontmatter: {
      title: "A reading corner for a small flat",
      slug,
      tags: [],
      locale: "en",
      publishedAt: "2026-01-01",
      draft: false,
      heroImage:
        "https://project.supabase.co/storage/v1/object/public/t/hero.jpg",
      heroImageAlt: "A lamp beside a low chair",
      sources: [],
      faq: [],
      sections: [],
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
      promise: "Three objects that make a corner feel finished.",
    },
  };
}

function productSlots(count: number): WallSlot[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "product" as const,
    product: buildProduct(index),
    ratio: "4:3" as const,
  }));
}

function renderWall(slots: WallSlot[], leftoverTrails: TrailEntry[] = []) {
  return render(
    <ProductWall
      slots={slots}
      leftoverTrails={leftoverTrails}
      locale="en"
      labels={labels}
    />,
  );
}

describe("ProductWall", () => {
  it("renders every tile into the markup regardless of the mobile cap", () => {
    const count = WALL_MOBILE_VISIBLE_COUNT + 5;
    const { container } = renderWall(productSlots(count));

    const list = screen.getByRole("list", { name: labels.heading });
    expect(within(list).getAllByRole("listitem").length).toBe(count);
    // The cap is CSS, never a slice: the last tile is in the server HTML.
    expect(screen.getByText(`Product ${count - 1}`)).toBeInTheDocument();
    expect(
      container.querySelectorAll("[data-selection-rationale]").length,
    ).toBe(count);

    // Everything past the cap is hidden by a class, not removed.
    const capped = Array.from(container.querySelectorAll("li")).filter((node) =>
      node.className.includes("hidden"),
    );
    expect(capped.length).toBe(5);
  });

  it("applies a row-span derived from each tile's ratio", () => {
    const { container } = renderWall([
      { kind: "product", product: buildProduct(0), ratio: "4:3" },
      { kind: "product", product: buildProduct(1), ratio: "1:1" },
      { kind: "product", product: buildProduct(2), ratio: "4:5" },
      { kind: "product", product: buildProduct(3), ratio: "3:4" },
    ]);

    // The span is a literal Tailwind class, so this also catches it drifting
    // away from `wallRowSpan()` — the two are declared in different places.
    const spans = Array.from(container.querySelectorAll("li")).map((node) =>
      Number(/grid-row:span_(\d+)/.exec(node.className)?.[1]),
    );

    expect(spans).toEqual([
      wallRowSpan("4:3"),
      wallRowSpan("1:1"),
      wallRowSpan("4:5"),
      wallRowSpan("3:4"),
    ]);
    // Taller buckets take proportionally more rows, in bucket height order.
    expect(spans[0]).toBeLessThan(spans[1]!);
    expect(spans[1]).toBeLessThan(spans[2]!);
    expect(spans[2]).toBeLessThan(spans[3]!);
  });

  it("preserves the wall's accessible name and list semantics", () => {
    renderWall(productSlots(3));

    expect(
      screen.getByRole("region", { name: labels.heading }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: labels.heading }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: labels.heading }),
    ).toBeInTheDocument();
  });

  it("renders the 看更多 control only when tiles exceed the cap", () => {
    const { unmount } = renderWall(productSlots(WALL_MOBILE_VISIBLE_COUNT));
    expect(screen.queryByRole("button", { name: labels.showMore })).toBeNull();
    unmount();

    renderWall(productSlots(WALL_MOBILE_VISIBLE_COUNT + 1));
    expect(
      screen.getByRole("button", { name: labels.showMore }),
    ).toBeInTheDocument();
  });

  it("degrades to a single trail tile", () => {
    const { container } = renderWall([
      { kind: "trail", trail: buildTrail(), format: "tall" },
    ]);

    const list = screen.getByRole("list", { name: labels.heading });
    expect(within(list).getAllByRole("listitem").length).toBe(1);
    expect(
      screen.getByText("A reading corner for a small flat"),
    ).toBeInTheDocument();
    // No leftover trails means no empty continuation strip.
    expect(
      screen.queryByRole("navigation", { name: labels.trailLinksLabel }),
    ).toBeNull();
    expect(container.querySelector("li")?.className).toContain("grid-row:span");
  });
});
