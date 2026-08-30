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

// `TrustLabel` reads its own text from the catalogue — that is the whole point
// of the component, and why the caller's opt-in is the boolean `showsTrustLabel`
// prop rather than a string whose value would be discarded. The mock returns the
// real zh-TW value so a spec that greps for the label greps for what a reader
// sees.
const TRUST_LABEL_TEXT = "Formoria 選物";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "selected" ? TRUST_LABEL_TEXT : key,
}));

const labels = {
  cta: "Visit product",
  brandSiteCta: "Visit brand site",
  unavailable: "Link unavailable",
  madeInTaiwan: "Made in Taiwan",
};

function buildProduct(overrides: Partial<CuratedProduct> = {}): CuratedProduct {
  return {
    id: "product-1",
    brandId: "brand-1",
    key: "kettle",
    nameZh: "手沖壺",
    nameEn: "Pour-over kettle",
    category: "home",
    subcategory: "tableware",
    officialUrl: "https://example.com/kettle",
    imageUrl: "/i/curated-products/p/kettle.jpg",
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
    mitQualified: false,
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
        // The fixture opts IN on purpose, so a mode assertion below proves the
        // mode alone suppresses the label rather than that nobody asked.
        showsTrustLabel
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
    // deliberate editorial choice) now rests on ONE surface — brand detail,
    // which is `outbound` mode. If this goes red, the label has disappeared
    // site-wide. It is a `TrustLabel`, not a `Badge`: the closed union is what
    // stops a second trust string from being reintroduced through this prop.
    const { container } = renderWallTile({ mode: "outbound" });

    expect(container.textContent).toContain(
      "Steady in the hand, made for small kitchens",
    );
    const label = container.querySelector('[data-trust-label="selected"]');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe(TRUST_LABEL_TEXT);
  });

  it("renders no 選物 badge in wall or trail mode", () => {
    // D11, the contrast rule: a label renders only where its opposite is
    // visible. Every tile on the wall and every tile in a trail is selected, so
    // the label carries no information there — and the trail's own string was
    // 為這個主題選入, a DIFFERENT commitment that must not be migrated into the
    // 選物 label. Both real call sites have since stopped opting in and
    // `discover.selectedBadge` is gone from the catalogues, but the FIXTURE
    // still opts in on purpose: this asserts the mode alone suppresses the
    // label, not merely that the callers stopped asking.
    for (const mode of ["wall", "trail"] as const) {
      const tile = renderWallTile({ mode });
      expect(
        tile.container.querySelector('[data-trust-label="selected"]'),
      ).toBeNull();
      expect(tile.container.textContent).not.toContain(TRUST_LABEL_TEXT);
      tile.unmount();
    }
  });

  it("renders no 選物 badge when the caller does not opt in", () => {
    // The second half of the gate. A surface opts IN with `showsTrustLabel`; a
    // surface that stops opting in stops rendering the badge without the tile
    // needing to know which surface it is.
    const { container } = renderWallTile({
      mode: "outbound",
      showsTrustLabel: false,
    });

    expect(container.textContent).toContain(
      "Steady in the hand, made for small kitchens",
    );
    expect(container.querySelector('[data-trust-label="selected"]')).toBeNull();
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
    for (const mode of ["wall", "trail", "outbound", "shelf"] as const) {
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
    //
    // STILL TRUE AFTER D11, and for a second reason. 品牌提供 is now derived
    // from `brand_images.source === 'owner'` and rendered as a credit line
    // beside the image it credits, in the brand-detail gallery. A curated
    // product has no rights signal left to read — `curated_products.image_usage`
    // was dropped by 20260818130000_simplify_curated_products.sql — so a credit
    // here would be an inference, not a fact. The assertion is kept, its reason
    // widened.
    const tile = renderWallTile({ mode: "outbound" });

    // Pinned by value: the label no longer exists as a tile prop, so the only
    // way to catch its return is to look for the text itself.
    expect(tile.container.textContent).not.toContain("Brand provided");
    expect(tile.container.textContent).not.toContain("品牌提供");
  });

  it("renders no 收錄 badge in any mode", () => {
    // D11 again, from the other end: directory membership is vocabulary, not a
    // badge. Every brand in the directory is 收錄, so a badge saying so on one
    // tile distinguishes it from nothing. The word may appear in headings and
    // on /about; it may not appear inside a tile.
    for (const mode of ["wall", "trail", "outbound", "shelf"] as const) {
      const tile = renderWallTile({ mode });
      expect(tile.container.textContent).not.toContain("收錄");
      tile.unmount();
    }
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
    // `surfaceCardStyles` surface it sits in — the image plate would show as a
    // visible band. Covered modes take `bg-surface-deep` as a loading tint;
    // this one must not, which is what the negative pins.
    expect(box.className).toContain("bg-surface");
    expect(box.className).not.toContain("bg-surface-deep");
    view.unmount();
  });

  it("serves the three-up grid image source on both card modes", () => {
    // Both modes lay these tiles out with `Grid cols="thirds"`, so both take
    // the `tile` surface's hint and there is no override left to drift.
    //
    // The trail used to ask for `(max-width: 768px) 100vw, 720px`, correct when
    // it was a single 720px column and wrong the moment it became three-up: it
    // requested roughly 3x the pixels it displayed. Pinned as ONE expected
    // string for both modes, because a second string here is the thing that
    // went stale last time.
    const tileSizes =
      "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

    const trail = renderImageBox("trail");
    expect(trail.img.getAttribute("sizes")).toBe(tileSizes);
    trail.view.unmount();

    const outbound = renderImageBox("outbound");
    expect(outbound.img.getAttribute("sizes")).toBe(tileSizes);
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
    expect(box.className).toContain("bg-surface-deep");
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

  // --- shelf mode ---

  it("renders image-led tile with hover scrim in shelf mode", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    const img = container.querySelector("img")!;
    expect(img.className).toContain("object-cover");

    // The scrim caption div carries the bg-ground/95 class
    const scrim = container.querySelector(".bg-ground\\/95");
    expect(scrim).not.toBeNull();

    // Name and description present in the DOM
    expect(container.textContent).toContain("Pour-over kettle");
    expect(container.textContent).toContain(
      "Steady in the hand, made for small kitchens",
    );
  });

  it("hides description on mobile in shelf mode", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    // The description lives inside the scrim overlay, which carries sm: prefix
    // classes for visibility. The description itself is hidden on mobile via
    // `hidden sm:block`.
    const descEl = screen.getByText(
      "Steady in the hand, made for small kitchens",
    );
    expect(descEl.className).toContain("hidden");
    expect(descEl.className).toContain("sm:block");

    // It must be inside the scrim div, not in a separate in-flow block
    const scrim = container.querySelector(".bg-ground\\/95")!;
    expect(scrim.contains(descEl)).toBe(true);
  });

  it("keeps product anchor id in shelf mode", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    expect(container.querySelector("#product-kettle")).not.toBeNull();
  });

  it("renders no outbound chip in shelf mode", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    // No link with CTA text — shelf tiles are not clickable
    expect(screen.queryByRole("link", { name: /Visit product/ })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Visit brand site/ }),
    ).toBeNull();
    // No <a> elements at all
    expect(container.querySelectorAll("a").length).toBe(0);
  });
});
