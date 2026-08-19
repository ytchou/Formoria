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
  default: ({ fill: _fill, priority, ...props }: Record<string, unknown>) => (
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
  unavailable: "Link unavailable",
};

function buildProduct(overrides: Partial<CuratedProduct> = {}): CuratedProduct {
  return {
    id: "product-1",
    brandId: "brand-1",
    key: "kettle",
    nameZh: "手沖壺",
    nameEn: "Pour-over kettle",
    category: "home",
    subcategories: [],
    officialUrl: "https://example.com/kettle",
    imageUrl:
      "https://project.supabase.co/storage/v1/object/public/p/kettle.jpg",
    imageSourceUrl: null,
    visible: true,
    linkState: "ok",
    linkCheckedAt: null,
    sourceCheckedAt: null,
    reviewDueAt: null,
    productDescriptionZh: "手感穩定，適合小空間",
    productDescriptionEn: "Steady in the hand, made for small kitchens",
    productPosition: null,
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
    // The 選物 commitment in brand-voice.md ("Trust labels": Formoria 選物 is a
    // deliberate editorial choice) now rests entirely on the
    // non-wall modes. If this goes red, the text has disappeared site-wide.
    const { container } = renderWallTile({ mode: "outbound" });

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
    for (const mode of ["wall", "trail", "outbound"] as const) {
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
      mode: "outbound",
      product: buildProduct({ productDescriptionEn: null }),
    });

    expect(tile.container.textContent).toContain("手感穩定，適合小空間");
  });

  it("renders exactly one text block per non-wall tile", () => {
    // The second block was `notes` + a 品牌提供 badge. Both are gone: a product
    // now carries ONE description, so a second badge would have nothing behind
    // it (DEV-1496).
    const tile = renderWallTile({ mode: "outbound" });

    // Pinned by value: the label no longer exists as a tile prop, so the only
    // way to catch its return is to look for the text itself.
    expect(tile.container.textContent).not.toContain("Brand provided");
    expect(tile.container.textContent).not.toContain("品牌提供");
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
    // The bucket drives the box through an inline `aspect-ratio`, so NO aspect
    // utility may appear — neither the retired 4:3 arbitrary value nor the
    // shared `aspect-media` token that replaced it. Either would override the
    // bucket and flatten every tile back to one shape.
    expect(box.className).not.toMatch(/\baspect-/);
    expect(container.innerHTML).not.toMatch(/aspect-\[|aspect-media/);
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
      expect(
        tile.container.querySelector("img")?.getAttribute("data-priority"),
      ).toBe("false");
      tile.unmount();
    }
  });

  it("leaves outbound and trail modes unchanged", () => {
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
          mode="outbound"
          brandSlug="kettle-co"
          brandName="Kettle Co"
        />
      </ul>,
    );
    expect(broken.getByText("Link unavailable")).toBeInTheDocument();
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

  // DEV-1519: the image box is fitted to the corpus rather than steering the
  // crop inside a box that fits nothing. Fit mode is chosen per surface.
  // Rendered directly rather than through `renderWallTile`, whose name and
  // wall-only `ratio` default would both be inert here.
  function renderImageBox(mode: "outbound" | "trail") {
    const view = render(
      <ul>
        <SelectedProductTile
          locale="en"
          product={buildProduct()}
          labels={labels}
          mode={mode}
          brand={brand}
          brandSlug="kettle-co"
          brandName="Kettle Co"
        />
      </ul>,
    );
    const img = view.container.querySelector("img")!;
    return { view, img, box: img.parentElement! };
  }

  it("renders a square image box on the brand page", () => {
    const { view, img, box } = renderImageBox("outbound");

    expect(box.className).toContain("aspect-square");
    // Square, stated locally. A curated product is 1:1 by DEV-1519's own
    // measurement, not because it inherits the shared media ratio — so this
    // box must not pick up an arbitrary-value ratio class either.
    expect(box.className).not.toMatch(/aspect-\[/);
    expect(img.className).toContain("object-cover");
    view.unmount();
  });

  it("contains rather than crops the trail image", () => {
    const { view, img, box } = renderImageBox("trail");

    expect(img.className).toContain("object-contain");
    expect(img.className).not.toContain("object-cover");
    // A contained image letterboxes permanently, so the box must match the
    // `surfaceCardStyles` surface it sits in — `bg-muted` would show as a
    // visible band. Covered modes keep `bg-muted` as a loading tint.
    expect(box.className).toContain("bg-card");
    expect(box.className).not.toContain("bg-muted");
    view.unmount();
  });

  it("serves a single-column image source on trail", () => {
    // The trail is one column inside `max-w-[720px]`; the brand page's 3-col
    // formula under-served it by ~40%, which `object-contain` makes visible.
    const trail = renderImageBox("trail");
    expect(trail.img.getAttribute("sizes")).toBe(
      "(max-width: 768px) 100vw, 720px",
    );
    trail.view.unmount();

    const outbound = renderImageBox("outbound");
    expect(outbound.img.getAttribute("sizes")).toBe(
      "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
    );
    outbound.view.unmount();
  });

  it("leaves the wall image box untouched by the per-surface branching", () => {
    // DEV-1519 requires `wallContent` to stay byte-identical, and the new
    // per-surface branching sits directly below it sharing the same
    // `imageSrc`/`BrandImageFallback` shape. Without this, a refactor folding
    // the wall into that branching would pass every other spec here while
    // silently changing the wall's fit, its box tone or its `sizes`.
    //
    // This is also where the reduced-motion kill-switch is now pinned: the
    // wall is the only surface that animates the image. `0.01ms` rather than
    // `none` is the documented idiom — a zero-length transition still fires
    // its events, where `none` removes them.
    const { container, unmount } = renderWallTile();
    const img = container.querySelector("img")!;
    const box = img.parentElement!;

    expect(img.className).toContain("object-cover");
    expect(img.className).toContain("transition-transform");
    expect(img.className).toContain("motion-reduce:duration-[0.01ms]");
    expect(box.className).toContain("bg-muted");
    expect(img.getAttribute("sizes")).toBe(
      "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1600px) 25vw, 362px",
    );
    unmount();
  });

  it("suppresses the brand-page furniture in wall mode", () => {
    renderWallTile({ product: buildProduct({ linkState: "broken" }) });

    expect(screen.queryByText("Brand provided")).toBeNull();
    expect(screen.queryByText("Link unavailable")).toBeNull();
    expect(screen.queryByRole("link", { name: /Visit brand site/ })).toBeNull();
  });
});
