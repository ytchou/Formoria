// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CuratedProduct } from "@/lib/services/curated-products";
import { SelectedProductTile, WALL_ABOVE_FOLD } from "../selected-product-tile";

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
    notesZh: "品牌提供的材質說明",
    notesEn: "A brand-supplied material note",
    highlightPosition: null,
    highlightRationaleZh: null,
    highlightRationaleEn: null,
    wallPosition: null,
    createdAt: "2026-01-01T00:00:00Z",
    trailSlug: null,
    sectionKey: null,
    position: 0,
    rationaleZh: "手感穩定，適合小空間",
    rationaleEn: "  Steady in the hand, made for small kitchens  ",
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
  it("renders exactly one rationale element per tile", () => {
    const { container } = renderWallTile();

    const nodes = container.querySelectorAll("[data-selection-rationale]");
    expect(nodes.length).toBe(1);

    const node = nodes[0]!;
    const attribute = node.getAttribute("data-selection-rationale")!;
    // The e2e cheerio contract: the attribute is already trimmed AND equals the
    // visible text, so the mobile caption and the desktop scrim cannot be two
    // nodes that drift apart.
    expect(attribute).toBe(attribute.trim());
    expect(node.textContent?.trim()).toBe(attribute);
    expect(attribute).toBe("Steady in the hand, made for small kitchens");
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

  it("marks the first N tiles priority", () => {
    const { container: aboveFold } = renderWallTile({
      wallIndex: WALL_ABOVE_FOLD - 1,
    });
    expect(
      aboveFold.querySelector("img")?.getAttribute("data-priority"),
    ).toBe("true");

    const { container: belowFold } = renderWallTile({
      wallIndex: WALL_ABOVE_FOLD,
    });
    expect(belowFold.querySelector("img")?.getAttribute("data-priority")).toBe(
      "false",
    );

    const { container: untracked } = renderWallTile();
    expect(untracked.querySelector("img")?.getAttribute("data-priority")).toBe(
      "false",
    );
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
    // The outbound chip, the brand-provided badge and the rationale body all
    // stay on the brand page variant.
    expect(
      outbound.getByRole("link", { name: /Visit product/ }),
    ).toBeInTheDocument();
    expect(
      outbound.getByText("A brand-supplied material note"),
    ).toBeInTheDocument();
    expect(outbound.getAllByText("Brand provided").length).toBe(1);
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
