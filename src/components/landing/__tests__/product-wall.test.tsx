// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { trackViewItemList } from "@/lib/analytics";
import {
  buildWallSlots,
  MAX_HOME_WALL_PRODUCTS,
  type WallSlot,
  type WallTrailSlot,
} from "@/lib/curated-products/home-wall";
import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";
import { WALL_RATIOS } from "@/lib/curated-products/wall-ratio";
import {
  ProductWall,
  WALL_LINE_SIZE_DESKTOP,
  WALL_MOBILE_VISIBLE_COUNT,
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
  trackViewItemList: vi.fn(),
  trackStockistListViewed: vi.fn(),
}));

const labels = {
  heading: "Formoria selections",
  note: "Chosen for a situation; open one to meet the brand behind it.",
  showMore: "See more selections",
  showLess: "Show fewer selections",
  product: {
    cta: "Visit product",
    brandSiteCta: "Visit brand site",
    unavailable: "Link unavailable",
  },
  trail: { eyebrow: "Trail", cta: "Explore this trail" },
};

/**
 * Real editorial copy, not `Product 1` / `Reason 1`. Uniform-length ASCII
 * cannot surface what this layout is actually exposed to: CJK line breaking, a
 * description long enough to hit `line-clamp-3`, a product with no English name
 * at all (the tile then renders the zh-TW one), and a title short enough to
 * leave the scrim half empty. Lengths vary on purpose.
 */
const WALL_FIXTURES = [
  {
    nameZh: "手沖壺",
    nameEn: "Pour-over kettle",
    descriptionZh: "手感穩定，適合小空間的早晨。",
    descriptionEn: "Steady in the hand, made for small kitchens.",
    brandName: "小器生活",
  },
  {
    nameZh: "麻布長桌巾（原色）",
    nameEn: null,
    descriptionZh:
      "洗過幾次之後才會出現的柔軟，是這塊布最好的時候；長度足夠蓋住六人餐桌的兩側，收起來也不佔位子。",
    descriptionEn: null,
    brandName: "本嶼織物",
  },
  {
    nameZh: "陶土馬克杯",
    nameEn: "Stoneware mug",
    descriptionZh: "杯口薄、杯身厚，熱飲不燙手。",
    descriptionEn:
      "A thin rim over a thick body — hot drinks without a hot handle, and it stacks.",
    brandName: "土屋陶作",
  },
  {
    nameZh: "黃銅書籤",
    nameEn: null,
    descriptionZh: "用久了會變色，那是它記錄時間的方式。",
    descriptionEn: null,
    brandName: "日星鑄字",
  },
  {
    nameZh: "無染色棉質浴巾",
    nameEn: "Undyed cotton bath towel",
    descriptionZh:
      "吸水快、乾得也快，適合沒有陽台的租屋處，是我們反覆比較之後留下來的一條。",
    descriptionEn:
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
    category: "home",
    subcategories: [],
    officialUrl: "https://example.com/product",
    imageUrl: `https://project.supabase.co/storage/v1/object/public/p/${index}.jpg`,
    imageSourceUrl: null,
    visible: true,
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: null,
    reviewDueAt: null,
    productDescriptionZh: fixture.descriptionZh,
    productDescriptionEn: fixture.descriptionEn,
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

function buildTrail(
  slug = "small-space-reading-corner",
  title = "A reading corner for a small flat",
): TrailEntry {
  return {
    slug,
    frontmatter: {
      title,
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

function renderWall(slots: WallSlot[]) {
  return render(<ProductWall slots={slots} locale="en" labels={labels} />);
}

describe("ProductWall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders every tile into the markup regardless of the mobile cap", () => {
    // A multiple of the desktop line size, so the tail trim does not remove
    // tiles underneath this assertion — `trims the tail` covers that separately.
    const count = WALL_MOBILE_VISIBLE_COUNT + WALL_LINE_SIZE_DESKTOP;
    const { container } = renderWall(productSlots(count));

    const list = screen.getByRole("list", { name: labels.heading });
    expect(within(list).getAllByRole("listitem").length).toBe(count);
    // The cap is CSS, never a slice: the last tile is in the server HTML.
    expect(screen.getByText(fixtureName(count - 1))).toBeInTheDocument();
    // Zero, not `count`: the wall stopped rendering selection rationales on
    // 2026-08-17 (see selected-product-tile.tsx). Asserted rather than deleted
    // so a rationale silently returning to the wall goes red here.
    expect(
      container.querySelectorAll("[data-selection-rationale]").length,
    ).toBe(0);

    // Everything past the cap is hidden by a class, not removed.
    const capped = Array.from(
      container.querySelectorAll("li:not([role='presentation'])"),
    ).filter((node) => node.className.includes("hidden"));
    expect(capped.length).toBe(WALL_LINE_SIZE_DESKTOP);
  });

  it("sizes each tile proportionally to its ratio, so a line justifies", () => {
    const { container } = renderWall([
      { kind: "product", product: buildProduct(0), ratio: "3:4" },
      { kind: "product", product: buildProduct(1), ratio: "4:5" },
      { kind: "product", product: buildProduct(2), ratio: "1:1" },
      { kind: "product", product: buildProduct(3), ratio: "4:3" },
    ]);

    const tiles = Array.from(
      container.querySelectorAll<HTMLLIElement>("li:not([role='presentation'])"),
    );
    expect(tiles).toHaveLength(4);

    // Both flex axes read the SAME custom property. That identity is the whole
    // mechanism: basis and grow proportional to r give width proportional to r,
    // and therefore one shared height per line. If either class stops reading
    // `--tile-ratio`, lines stop justifying and the wall goes ragged again.
    for (const tile of tiles) {
      expect(tile.className).toContain(
        "sm:basis-[calc(var(--wall-line-h)*var(--tile-ratio))]",
      );
      expect(tile.className).toContain("sm:grow-[var(--tile-ratio)]");
      // One tile per line on phones, so no growth there.
      expect(tile.className).toContain("basis-full");
      expect(tile.className).toContain("grow-0");
    }

    const ratios = tiles.map((tile) =>
      Number(tile.style.getPropertyValue("--tile-ratio")),
    );
    expect(ratios).toEqual([
      WALL_RATIOS["3:4"],
      WALL_RATIOS["4:5"],
      WALL_RATIOS["1:1"],
      WALL_RATIOS["4:3"],
    ]);
    // Wider bucket, wider tile — the variation is carried by width now, and it
    // is strictly monotonic across the four buckets.
    expect(ratios[0]).toBeLessThan(ratios[1]!);
    expect(ratios[1]).toBeLessThan(ratios[2]!);
    expect(ratios[2]).toBeLessThan(ratios[3]!);
  });

  it("breaks lines at four from lg and at two below it", () => {
    const { container } = renderWall(productSlots(WALL_LINE_SIZE_DESKTOP * 2));

    const breaks = Array.from(
      container.querySelectorAll<HTMLLIElement>("li[role='presentation']"),
    );
    // Two tablet-only breaks (after tiles 2 and 6) and ONE shared break (after
    // 4) — the shared one is what makes the line four wide at lg. There is no
    // break after tile 8: it is the last tile, and a break there is an empty
    // flex line plus a row gap hanging under the wall.
    expect(breaks).toHaveLength(3);
    expect(
      breaks.filter((node) => node.className.includes("lg:hidden")),
    ).toHaveLength(2);
    // The row gap lives on the breaks from `sm` up, not on the list: a
    // `basis-full` break takes a flex line of its own, so a list row-gap would
    // separate every pair of tile lines by two gaps instead of one.
    for (const node of breaks) {
      expect(node.className).toContain("sm:h-4");
    }
    const list = container.querySelector("ul");
    expect(list?.className).toContain("sm:gap-y-0");
    // A break must never be announced as an item of the list.
    for (const node of breaks) {
      expect(node).toHaveAttribute("aria-hidden", "true");
    }
    expect(
      within(screen.getByRole("list", { name: labels.heading })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(WALL_LINE_SIZE_DESKTOP * 2);
  });

  it("trims the tail so the last line is full rather than stretched", () => {
    // 13 slots is three full lines plus one orphan. Left alone, flex stretches
    // that orphan across the entire measure.
    const { container } = renderWall(productSlots(13));
    const tiles = container.querySelectorAll("li:not([role='presentation'])");
    expect(tiles).toHaveLength(12);
    expect(tiles.length % WALL_LINE_SIZE_DESKTOP).toBe(0);

    // Under one full line nothing is dropped — three tiles is still a wall.
    const short = renderWall(productSlots(3));
    expect(
      short.container.querySelectorAll("li:not([role='presentation'])"),
    ).toHaveLength(3);
  });

  it("takes the trim out of products, so no composed trail vanishes", () => {
    // The real composition, not hand-built slots: at a 16-product cap and a
    // trail every 8 slots `buildWallSlots` reserves TWO trails and returns 18
    // slots ENDING on one of them. A tail slice back to 16 therefore deleted a
    // composed trail; the trim must fall on products instead.
    const products = Array.from(
      { length: MAX_HOME_WALL_PRODUCTS + 4 },
      (_, index) => buildProduct(index),
    );
    const trails = [
      buildTrail("trail-a", "Where to read in a small flat"),
      buildTrail("trail-b", "A table set for four"),
    ];
    const slots = buildWallSlots({
      products,
      trails,
      seed: "2026-08-17",
    });

    const composedTrails = slots.filter(
      (slot): slot is WallTrailSlot => slot.kind === "trail",
    );
    // The premise of the test: fewer than two reserved trails and the trim has
    // nothing to drop, so the assertion below would pass vacuously.
    expect(composedTrails).toHaveLength(2);

    const { container } = renderWall(slots);

    // The wall still ends on a full line — the trim is wanted, only its
    // victim changed.
    const tiles = container.querySelectorAll("li:not([role='presentation'])");
    expect(tiles.length % WALL_LINE_SIZE_DESKTOP).toBe(0);
    expect(tiles).toHaveLength(16);
    // Two of the sixteen are trails, so fourteen products are reported.
    expect(trackViewItemList).toHaveBeenCalledWith("home_wall", 14);
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

    renderWall(productSlots(WALL_MOBILE_VISIBLE_COUNT + WALL_LINE_SIZE_DESKTOP));
    expect(
      screen.getByRole("button", { name: labels.showMore }),
    ).toBeInTheDocument();
  });

  it("reveals with disclosure semantics and keeps focus on the control", async () => {
    const user = userEvent.setup();
    renderWall(productSlots(WALL_MOBILE_VISIBLE_COUNT + WALL_LINE_SIZE_DESKTOP));

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
    // The wall no longer owns a continuation strip at all — leftover trails
    // render as their own zone (see landing-zones.tsx). Asserted so the strip
    // cannot reappear here.
    expect(container.querySelector(".border-t")).toBeNull();
    expect(container.querySelector("li")?.className).toContain(
      "sm:grow-[var(--tile-ratio)]",
    );
  });

  it("renders a repo-local hero path, which safeImageSrc drops on its own", () => {
    // `safeImageSrc` (allowed-image-hosts.ts:47) builds `new URL(url)` with NO
    // base, so every relative path throws and returns null — only
    // `*.supabase.co` survived. A hero committed at `/images/trails/…` passed
    // the frontmatter disk check, reserved a wall slot, and still rendered an
    // imageless tile. This is the assertion for that whole class.
    const trail = buildTrail();
    trail.frontmatter.heroImage =
      "/images/trails/small-space-reading-corner.webp";
    trail.frontmatter.heroImageAlt = "A lamp beside a low chair";

    const { container } = renderWall([
      { kind: "trail", trail, format: "tall" },
    ]);

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(
      "/images/trails/small-space-reading-corner.webp",
    );
    expect(image?.getAttribute("alt")).toBe("A lamp beside a low chair");
  });

  it("falls back to an empty alt rather than repeating the title", () => {
    // The link is already `aria-labelledby` the title, so an alt that repeats
    // it announces the same words twice.
    const trail = buildTrail();
    trail.frontmatter.heroImage = "/images/trails/small-space-reading-corner.webp";
    delete trail.frontmatter.heroImageAlt;

    const { container } = renderWall([
      { kind: "trail", trail, format: "wide" },
    ]);

    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("still renders a remote hero on an allowed host", () => {
    const { container } = renderWall([
      { kind: "trail", trail: buildTrail(), format: "tall" },
    ]);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://project.supabase.co/storage/v1/object/public/t/hero.jpg",
    );
  });
});
