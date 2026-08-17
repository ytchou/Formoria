// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CuratedProduct } from "@/lib/services/curated-products";
import { SelectedProductTile } from "../selected-product-tile";

// `next/image` becomes a plain `img` so the props this spec reads — `priority`
// and `sizes` — land on the DOM verbatim instead of being consumed by the
// optimizer wrapper. `priority` is surfaced as a data attribute because React
// would drop the unknown boolean prop from an `<img>`.
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority,
    ...props
  }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
    <img alt="" data-priority={priority ? "true" : "false"} {...props} />
  ),
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
  trackOutboundClick: vi.fn(),
}));

const labels = {
  cta: "Visit product",
  brandSiteCta: "Visit brand site",
  selectedBadge: "Formoria selection",
  brandProvidedBadge: "Brand provided",
  unavailable: "Link unavailable",
};

function buildProduct(overrides: Partial<CuratedProduct> = {}): CuratedProduct {
  return {
    id: "product-1",
    brandId: "brand-1",
    key: "kettle",
    nameZh: "手沖壺",
    nameEn: "Pour-over kettle",
    l1: "home",
    l2: [],
    officialUrl: "https://example.com/kettle",
    imageUrl: "https://project.supabase.co/storage/v1/object/public/p/kettle.jpg",
    imageSourceUrl: null,
    imageUsage: "permitted",
    lifecycle: "active",
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: null,
    reviewDueAt: null,
    productDescriptionZh: "手感穩定，適合小空間",
    productDescriptionEn: "Steady in the hand, made for small kitchens",
    productPosition: null,
    wallPosition: null,
    createdAt: "2026-01-01T00:00:00Z",
    trailSlug: null,
    sectionKey: null,
    position: 0,
    ...overrides,
  };
}

const brand = {
  slug: "kettle-co",
  purchaseWebsite: "https://example.com",
  purchasePinkoi: null,
  purchaseShopee: null,
  purchaseMyship: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
};

function renderWallTile(
  props: Partial<Parameters<typeof SelectedProductTile>[0]> = {},
) {
  return render(
    <ul>
      <SelectedProductTile
        locale="en"
        product={buildProduct()}
        labels={labels}
        mode="wall"
        brand={brand}
        brandSlug="kettle-co"
        brandName="Kettle Co"
        ratio="4:3"
        {...props}
      />
    </ul>,
  );
}

describe("SelectedProductTile", () => {
  it("renders no text but name and brand on a wall tile", () => {
    // Removed 2026-08-17 by product decision: the wall is a sheet of
    // photographs and the copy read as product specs. The tile still receives
    // a non-empty description from the fixture, so this asserts the wall drops
    // it rather than that there was none.
    const { container } = renderWallTile();

    expect(container.textContent).toContain("Pour-over kettle");
    expect(container.textContent).toContain("Kettle Co");
    expect(container.textContent).not.toContain(
      "Steady in the hand, made for small kitchens",
    );
  });

  it("renders the description with the 選物 badge on the brand page", () => {
    // The 選物 commitment in brand-voice.md:71 now rests entirely on the
    // non-wall modes. If this goes red, the text has disappeared site-wide.
    const { container } = renderWallTile({ mode: "internal" });

    expect(container.textContent).toContain(
      "Steady in the hand, made for small kitchens",
    );
    expect(container.textContent).toContain(labels.selectedBadge);
  });

  it("renders the description on a trail tile", () => {
    const trail = render(
      <ul>
        <SelectedProductTile
          locale="en"
          product={buildProduct()}
          labels={labels}
          mode="trail"
          brand={brand}
          brandSlug="kettle-co"
          brandName="Kettle Co"
        />
      </ul>,
    );

    expect(trail.container.textContent).toContain(
      "Steady in the hand, made for small kitchens",
    );
    expect(
      trail.getByRole("link", { name: /Visit product/ }),
    ).toBeInTheDocument();
    trail.unmount();
  });

  it("carries no data-selection-rationale attribute in any mode", () => {
    for (const mode of ["wall", "internal", "trail", "outbound"] as const) {
      const tile = renderWallTile({ mode });
      expect(
        tile.container.querySelectorAll("[data-selection-rationale]").length,
      ).toBe(0);
      tile.unmount();
    }
  });

  it("falls back to zh when the en description is null", () => {
    // EN locale, no English twin: the reader gets the zh text rather than an
    // empty block, which is what `product_description_en` being nullable buys.
    const tile = renderWallTile({
      mode: "internal",
      product: buildProduct({ productDescriptionEn: null }),
    });

    expect(tile.container.textContent).toContain("手感穩定，適合小空間");
  });

  it("renders exactly one text block per non-wall tile", () => {
    // The second block was `notes` + a 品牌提供 badge. Both are gone: a product
    // now carries ONE description, so a second badge would have nothing behind
    // it (DEV-1496).
    const tile = renderWallTile({ mode: "internal" });

    expect(tile.container.textContent).not.toContain(
      labels.brandProvidedBadge,
    );
  });

  it("links a wall tile to the top of the brand page, with no anchor", () => {
    // A homepage tile is first contact with the brand, so it must not drop the
    // reader mid-page at one product (changed 2026-08-17).
    const { container } = renderWallTile();

    const link = container.querySelector("a")!;
    expect(link).toHaveAttribute("href", "/brands/kettle-co");
    expect(link.getAttribute("href")).not.toContain("#");
    // The tile keeps its own anchor id — the brand page's anchors point at it.
    expect(container.querySelector("#product-kettle")).not.toBeNull();
  });

  it("applies the bucket aspect ratio via inline style", () => {
    const { container } = renderWallTile({ ratio: "3:4" });

    const box = container.querySelector("[data-wall-ratio]")!;
    expect(box.getAttribute("data-wall-ratio")).toBe("3:4");
    expect(box.className).not.toContain("aspect-[4/3]");
    expect(container.innerHTML).not.toContain("aspect-[4/3]");
  });

  it("falls back to 4:3 when the bucket is absent", () => {
    const { container } = renderWallTile({ ratio: undefined });

    const box = container.querySelector("[data-wall-ratio]")!;
    expect(box.getAttribute("data-wall-ratio")).toBe("4:3");
  });

  it("never preloads a wall image", () => {
    // The hero photograph is the LCP element and owns the page's single
    // preload. This replaced a `WALL_ABOVE_FOLD` counter that went to 0 when
    // the hero image was restored, leaving a comparison that could never be
    // true — so the guard is now "no wall tile preloads, ever".
    for (const tile of [renderWallTile(), renderWallTile({ ratio: "1:1" })]) {
      expect(tile.container.querySelector("img")?.getAttribute("data-priority")).toBe(
        "false",
      );
      tile.unmount();
    }
  });

  it("leaves outbound, internal and trail modes unchanged", () => {
    const outbound = render(
      <ul>
        <SelectedProductTile
          locale="en"
          product={buildProduct()}
          labels={labels}
          mode="outbound"
          brand={brand}
        />
      </ul>,
    );
    // The outbound chip and the description body stay on the brand page
    // variant; the brand-provided badge is gone with the notes field.
    expect(
      outbound.getByRole("link", { name: /Visit product/ }),
    ).toBeInTheDocument();
    expect(
      outbound.getByText("Steady in the hand, made for small kitchens"),
    ).toBeInTheDocument();
    expect(outbound.queryByText("Brand provided")).toBeNull();
    outbound.unmount();

    const broken = render(
      <ul>
        <SelectedProductTile
          locale="en"
          product={buildProduct({ linkState: "broken" })}
          labels={labels}
          mode="internal"
          brandSlug="kettle-co"
          brandName="Kettle Co"
        />
      </ul>,
    );
    expect(broken.getByText("Link unavailable")).toBeInTheDocument();
    // `internal` keeps the anchor — the reader is already on a brand page and
    // asked for one product. Only `wall` drops it (see the wall spec below).
    expect(
      broken.getByRole("link", { name: /Pour-over kettle/ }),
    ).toHaveAttribute("href", "/brands/kettle-co#product-kettle");
    broken.unmount();

    const trail = render(
      <ul>
        <SelectedProductTile
          locale="en"
          product={buildProduct()}
          labels={labels}
          mode="trail"
          brand={brand}
          brandSlug="kettle-co"
          brandName="Kettle Co"
        />
      </ul>,
    );
    expect(
      trail.getByRole("link", { name: "Pour-over kettle" }),
    ).toHaveAttribute("href", "/brands/kettle-co#product-kettle");
    expect(trail.getByRole("link", { name: /Visit product/ })).toHaveAttribute(
      "href",
      "https://example.com/kettle",
    );
    trail.unmount();
  });

  it("suppresses the brand-page furniture in wall mode", () => {
    renderWallTile({ product: buildProduct({ linkState: "broken" }) });

    expect(screen.queryByText("Brand provided")).toBeNull();
    expect(screen.queryByText("Link unavailable")).toBeNull();
    expect(screen.queryByRole("link", { name: /Visit brand site/ })).toBeNull();
  });
});
