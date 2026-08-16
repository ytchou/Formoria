// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { trackViewItemList } from "@/lib/analytics";
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
  showLess: "Show fewer selections",
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

/**
 * Real editorial copy, not `Product 1` / `Reason 1`. Uniform-length ASCII
 * cannot surface what this layout is actually exposed to: CJK line breaking, a
 * rationale long enough to hit `line-clamp-3`, a product with no English name
 * at all (the tile then renders the zh-TW one), and a title short enough to
 * leave the scrim half empty. Lengths vary on purpose.
 */
const WALL_FIXTURES = [
  {
    nameZh: "手沖壺",
    nameEn: "Pour-over kettle",
    rationaleZh: "手感穩定，適合小空間的早晨。",
    rationaleEn: "Steady in the hand, made for small kitchens.",
    brandName: "小器生活",
  },
  {
    nameZh: "麻布長桌巾（原色）",
    nameEn: null,
    rationaleZh:
      "洗過幾次之後才會出現的柔軟，是這塊布最好的時候；長度足夠蓋住六人餐桌的兩側，收起來也不佔位子。",
    rationaleEn: null,
    brandName: "本嶼織物",
  },
  {
    nameZh: "陶土馬克杯",
    nameEn: "Stoneware mug",
    rationaleZh: "杯口薄、杯身厚，熱飲不燙手。",
    rationaleEn:
      "A thin rim over a thick body — hot drinks without a hot handle, and it stacks.",
    brandName: "土屋陶作",
  },
  {
    nameZh: "黃銅書籤",
    nameEn: null,
    rationaleZh: "用久了會變色，那是它記錄時間的方式。",
    rationaleEn: null,
    brandName: "日星鑄字",
  },
  {
    nameZh: "無染色棉質浴巾",
    nameEn: "Undyed cotton bath towel",
    rationaleZh:
      "吸水快、乾得也快，適合沒有陽台的租屋處，是我們反覆比較之後留下來的一條。",
    rationaleEn:
      "Fast to soak, faster to dry — the one we kept after testing towels in a flat with no balcony.",
    brandName: "禾織",
  },
];

/** The name the tile actually renders in the `en` locale. */
function fixtureName(index: number): string {
  const fixture = WALL_FIXTURES[index % WALL_FIXTURES.length]!;
  const base = fixture.nameEn ?? fixture.nameZh;
  return `${base}／${index}`;
}

function buildProduct(index: number): HomepageCuratedProduct {
  const fixture = WALL_FIXTURES[index % WALL_FIXTURES.length]!;
  return {
    id: `product-${index}`,
    brandId: `brand-${index}`,
    key: `product-${index}`,
    nameZh: `${fixture.nameZh}／${index}`,
    nameEn: fixture.nameEn ? `${fixture.nameEn}／${index}` : null,
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
    rationaleZh: fixture.rationaleZh,
    rationaleEn: fixture.rationaleEn,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders every tile into the markup regardless of the mobile cap", () => {
    const count = WALL_MOBILE_VISIBLE_COUNT + 5;
    const { container } = renderWall(productSlots(count));

    const list = screen.getByRole("list", { name: labels.heading });
    expect(within(list).getAllByRole("listitem").length).toBe(count);
    // The cap is CSS, never a slice: the last tile is in the server HTML.
    expect(screen.getByText(fixtureName(count - 1))).toBeInTheDocument();
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

  it("reveals with disclosure semantics and keeps focus on the control", async () => {
    const user = userEvent.setup();
    renderWall(productSlots(WALL_MOBILE_VISIBLE_COUNT + 3));

    const control = screen.getByRole("button", { name: labels.showMore });
    const list = screen.getByRole("list", { name: labels.heading });

    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(control.getAttribute("aria-controls")).toBe(list.getAttribute("id"));
    expect(list.getAttribute("id")).toBeTruthy();

    await user.click(control);

    // The control survives activation, so focus is never dropped to <body> and
    // the state change is announced where the user already is.
    const expanded = screen.getByRole("button", { name: labels.showLess });
    expect(expanded).toHaveAttribute("aria-expanded", "true");
    expect(expanded).toHaveFocus();
    expect(list.dataset.wallExpanded).toBe("true");
  });

  it("counts only product slots for view_item_list", () => {
    renderWall([
      { kind: "product", product: buildProduct(0), ratio: "4:3" },
      { kind: "trail", trail: buildTrail("trail-a"), format: "wide" },
      { kind: "product", product: buildProduct(1), ratio: "1:1" },
    ]);

    // A trail tile is not an item of this list. The list NAME is the existing
    // analytics series key and must stay byte-identical.
    expect(trackViewItemList).toHaveBeenCalledWith("home_wall", 2);
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
