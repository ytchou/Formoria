// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CuratedProduct } from "@/lib/services/curated-products";
import enMessages from "../../../../messages/en.json";
import { subcategoryDisplayLabel } from "@/lib/taxonomy/ontology";
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

vi.mock("@/components/ui/save-button", () => ({
  SaveButton: () => <button data-testid="save-button" />,
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

  it("renders the description without duplicate labels or links on the brand page", () => {
    const { container } = renderWallTile({ mode: "outbound" });

    expect(container.textContent).toContain(
      "Steady in the hand, made for small kitchens",
    );
    expect(container.querySelector('[data-trust-label="selected"]')).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders no 選物 badge in wall or trail mode", () => {
    for (const mode of ["wall", "trail"] as const) {
      const tile = renderWallTile({ mode });
      expect(
        tile.container.querySelector('[data-trust-label="selected"]'),
      ).toBeNull();
      tile.unmount();
    }
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

  it("keeps the product link on trail cards only", () => {
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
    expect(outbound.queryByRole("link", { name: /Visit product/ })).toBeNull();
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

  it("covers rather than contains the trail image", () => {
    // DS-26: the trail is a three-up grid, so products sit side by side and a
    // letterboxed edge breaks the row (DESIGN.md §6). A covered image only
    // shows its box while loading, so the trail takes the same
    // `bg-surface-deep` plate as every other mode.
    const { view, img, box } = renderImageBox("trail");

    expect(img.className).toContain("object-cover");
    expect(img.className).not.toContain("object-contain");
    expect(box.className).toContain("bg-surface-deep");
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

  // DS-10: the caption sits in flow below the photograph at every viewport —
  // never a hover-revealed scrim over it.
  it("renders the wall caption in flow below the image", () => {
    const { container } = renderWallTile();

    const name = screen.getByRole("heading", { name: "Pour-over kettle" });
    const caption = name.parentElement!;
    expect(caption.textContent).toContain("Kettle Co");
    expect(caption.className).not.toMatch(/sm:absolute/);
    expect(caption.className).not.toMatch(/opacity-0/);
    expect(caption.className).not.toContain("bg-ground/95");
    expect(container.innerHTML).not.toContain("bg-gradient-to-t");
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    // The image box precedes the caption; the caption is not inside it.
    const box = container.querySelector("[data-wall-ratio]")!;
    expect(box.contains(caption)).toBe(false);
    expect(
      box.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("insets the wall caption when the tile sits on a ground plate", () => {
    // DS-12: the homepage band passes `bg-ground` on the tile; the ancestor
    // variant keeps the caption text off the plate's edge at every width.
    renderWallTile({ className: "bg-ground" });

    const caption = screen.getByRole("heading", {
      name: "Pour-over kettle",
    }).parentElement!;
    expect(caption.className).toContain("in-[.bg-ground]:px-3");
    expect(caption.className).toContain("in-[.bg-ground]:pb-3");
    expect(caption.className).not.toContain("max-sm:px-3");
  });

  it("suppresses the brand-page furniture in wall mode", () => {
    renderWallTile({ product: buildProduct({ linkState: "broken" }) });

    expect(screen.queryByText("Brand provided")).toBeNull();
    expect(screen.queryByText("Link unavailable")).toBeNull();
    expect(screen.queryByRole("link", { name: /Visit brand site/ })).toBeNull();
  });

  // --- shelf mode ---
  // DEV-1994: one honest link per shelf tile. Image + name are a single
  // outbound link to the product's own page (BD2-03, BD2-12, CP2-09).

  it("makes image and name one outbound link to the product page", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link).toHaveAttribute("href", "https://example.com/kettle");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("data-brand-slug", "kettle-co");
    expect(link).toHaveAttribute("data-link-type", "curated_product");
    expect(link).toHaveAttribute("data-link-surface", "selected_product");
    expect(link.querySelector("img")).not.toBeNull();
    expect(link.querySelector("h3")?.textContent).toBe("Pour-over kettle");
    expect(link.querySelector(".sr-only")?.textContent).toBe("Visit product");
    expect(container.querySelector('a[href*="#product-"]')).toBeNull();
    const image = container.querySelector("img")!;
    expect(image.className).toContain("object-cover");
    expect(image.className).toContain("group-hover:scale-[1.03]");
  });

  it("clamps the shelf name to two lines with a two-line floor", () => {
    renderWallTile({ mode: "shelf" });

    const classes = screen
      .getByRole("heading", { name: "Pour-over kettle" })
      .className.split(/\s+/);
    expect(classes).toContain("line-clamp-2");
    expect(classes).toContain("min-h-[2lh]");
  });

  it("renders no pill and no subcategory badge on a shelf tile", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    const subcategory = subcategoryDisplayLabel("tableware", "en");
    expect(subcategory).toBeTruthy();
    expect(container.textContent).not.toContain(subcategory);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("keeps the save button outside the shelf link", () => {
    renderWallTile({ mode: "shelf" });

    const save = screen.getByTestId("save-button");
    expect(save.closest("a")).toBeNull();
  });

  it("links a broken shelf product to the brand site with the brand-site hint", () => {
    const { container } = renderWallTile({
      mode: "shelf",
      product: buildProduct({ linkState: "broken" }),
    });

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.com");
    expect(links[0]).toHaveAttribute("data-link-type", "brand_site");
    expect(links[0]!.querySelector(".sr-only")?.textContent).toBe(
      "Visit brand site",
    );
    expect(screen.getByText("Link unavailable")).toBeInTheDocument();
  });

  it("renders image and name unlinked when the shelf tile has no destination", () => {
    const { container } = renderWallTile({
      mode: "shelf",
      product: buildProduct({ officialUrl: null }),
    });

    expect(container.querySelector("a")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Pour-over kettle" }),
    ).toBeInTheDocument();
  });

  it("reports a shelf image load failure through onImageError", () => {
    const onImageError = vi.fn();
    const { container } = renderWallTile({ mode: "shelf", onImageError });

    fireEvent.error(container.querySelector("img")!);
    expect(onImageError).toHaveBeenCalledTimes(1);
  });

  it("drops the hover scrim and the focus-only wrapper in shelf mode", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    expect(container.querySelector("[tabindex]")).toBeNull();
    expect(container.innerHTML).not.toContain("bg-ground/95");

    // The description shows at every viewport, clamped to two lines.
    const descEl = screen.getByText(
      "Steady in the hand, made for small kitchens",
    );
    expect(descEl.className).toContain("line-clamp-2");
    expect(descEl.className).not.toMatch(/\bhidden\b/);
  });

  it("keeps product anchor id in shelf mode, clear of the sticky header", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    const tile = container.querySelector("#product-kettle");
    expect(tile).not.toBeNull();
    expect(tile?.className).toContain("scroll-mt-40");
  });

  it("renders nothing for a photo-less product in shelf mode", () => {
    const { container } = renderWallTile({
      mode: "shelf",
      product: buildProduct({ imageUrl: null }),
    });

    expect(container.querySelector("[data-testid=image-fallback]")).toBeNull();
    expect(container.querySelector("li")).toBeNull();
  });

  // WCAG 3.1.2: an EN page falling back to zh text marks that part as zh.
  it("marks the zh name fallback with lang on an EN shelf tile", () => {
    renderWallTile({ mode: "shelf", product: buildProduct({ nameEn: null }) });

    expect(screen.getByRole("heading", { name: "手沖壺" })).toHaveAttribute(
      "lang",
      "zh-Hant-TW",
    );
  });

  it("marks the zh description fallback with lang on an EN shelf tile", () => {
    renderWallTile({
      mode: "shelf",
      product: buildProduct({ productDescriptionEn: null }),
    });

    expect(screen.getByText("手感穩定，適合小空間")).toHaveAttribute(
      "lang",
      "zh-Hant-TW",
    );
  });

  it("sets no lang attribute when both EN fields are present", () => {
    const { container } = renderWallTile({ mode: "shelf" });

    expect(container.querySelector("[lang]")).toBeNull();
  });
});

// D13/D14: a trail pick carries one short editorial note under its name.
describe("SelectedProductTile trail note", () => {
  const note = "無線的光";
  const description = "Steady in the hand, made for small kitchens";

  function renderTrailTile(
    props: Partial<Parameters<typeof SelectedProductTile>[0]> = {},
  ) {
    return render(
      <ul>
        <SelectedProductTile
          locale="en"
          product={buildProduct()}
          labels={labels}
          mode="trail"
          brand={brand}
          brandSlug="kettle-co"
          brandName="Kettle Co"
          note={note}
          {...props}
        />
      </ul>,
    );
  }

  it("trail mode renders the note under the product name", () => {
    const view = renderTrailTile();

    const name = view.getByRole("heading", { name: "Pour-over kettle" });
    const noteElement = view.getByText(note);
    expect(
      name.compareDocumentPosition(noteElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(noteElement.className).toContain("line-clamp-2");
    view.unmount();
  });

  it("trail mode clamps description to 2 lines and hides it on mobile", () => {
    // DS-25: `sm:block` overrode the `display: -webkit-box` that `line-clamp`
    // needs, so the clamp never applied. `max-sm:hidden` hides on phones and
    // sets no display above `sm`.
    const view = renderTrailTile();

    const descriptionElement = view.getByText(description);
    const classes = descriptionElement.className.split(/\s+/);
    expect(classes).toContain("line-clamp-2");
    expect(classes).toContain("max-sm:hidden");
    expect(classes).not.toContain("hidden");
    expect(classes).not.toContain("sm:block");
    view.unmount();
  });

  it("trail name link has a 44px hit area without resizing the text", () => {
    // DS-39 / DESIGN.md §7: the overlay grows the target, not the type.
    for (const tracking of [
      undefined,
      { brandSlug: "kettle-co", position: 0, surface: "trail:t:s" },
    ]) {
      const view = renderTrailTile({ tracking });

      const link = view.getByRole("link", { name: "Pour-over kettle" });
      const classes = link.className.split(/\s+/);
      expect(classes).toContain("relative");
      expect(classes).toContain("after:absolute");
      expect(classes).toContain("after:min-h-11");
      expect(link.querySelector("h3")?.className).toContain("type-card-title");
      view.unmount();
    }
  });

  it("trail mode shows the description at every width when there is no note", () => {
    const view = renderTrailTile({ note: undefined });

    const descriptionElement = view.getByText(description);
    expect(descriptionElement.className).toContain("line-clamp-2");
    expect(descriptionElement.className).not.toContain("hidden");
    view.unmount();
  });

  it("non-trail modes ignore note", () => {
    const wall = renderTrailTile({ mode: "wall", ratio: "4:3" });
    expect(wall.container.textContent).not.toContain(note);
    wall.unmount();

    const outbound = renderTrailTile({ mode: "outbound" });
    expect(outbound.container.textContent).not.toContain(note);
    outbound.unmount();
  });

  it("brand line is 明體 in ink-muted, not accent", () => {
    // DS2-19: brand names are content, so the 明體 face at ≥14px.
    const view = renderTrailTile();

    const classes = view.getByText("Kettle Co").className.split(/\s+/);
    expect(classes).not.toContain("text-accent");
    expect(classes).toContain("type-body-sm");
    expect(classes).toContain("text-ink-muted");
    view.unmount();
  });

  it("names the product in the chip's screen-reader text without punctuation", () => {
    const view = renderTrailTile();

    const chip = view.getByRole("link", { name: /Visit product/ });
    expect(chip.querySelector(".sr-only")?.textContent).toBe(
      " Pour-over kettle",
    );
    view.unmount();
  });
});

// DEV-1994 CP2-15: a 選物 label shows only with its reason — the guide.
describe("SelectedProductTile guide link", () => {
  const guide = {
    slug: "reading-corner",
    title: "小坪數閱讀角落",
    locale: "zh-TW",
  };

  function renderShelfTile(
    props: Partial<Parameters<typeof SelectedProductTile>[0]> = {},
  ) {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ul>
          <SelectedProductTile
            locale="en"
            product={buildProduct()}
            labels={{ ...labels, inGuide: "From the guide" }}
            mode="shelf"
            brand={brand}
            {...props}
          />
        </ul>
      </NextIntlClientProvider>,
    );
  }

  it("shows no trust label without a guide", () => {
    const { container } = renderShelfTile();

    expect(container.querySelector('[data-trust-label="selected"]')).toBeNull();
  });

  it("shows the trust label and a link to the guide that placed the product", () => {
    const { container } = renderShelfTile({ guide });

    const label = container.querySelector('[data-trust-label="selected"]');
    expect(label?.textContent).toBe(enMessages.trustLabel.selected);
    const link = screen.getByRole("link", { name: /小坪數閱讀角落/ });
    expect(link).toHaveAttribute("href", "/style/reading-corner");
    expect(link.querySelector(".sr-only")?.textContent).toContain(
      "From the guide",
    );
    expect(screen.getByText("小坪數閱讀角落")).toHaveAttribute(
      "lang",
      "zh-Hant-TW",
    );
    const classes = link.className.split(/\s+/);
    expect(classes).toContain("after:min-h-11");
    expect(classes).toContain("text-accent");
  });
});
