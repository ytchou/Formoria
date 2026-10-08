/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zhMessages from "../../../../messages/zh-TW.json";
import type { PublicBrandCard } from "@/lib/brands/contracts";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    preload: _preload,
    ...props
  }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
    <img alt="" {...props} />
  ),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  trackBrandCardClicked: vi.fn(),
  trackRecommendationBrandClicked: vi.fn(),
  trackSavedBrandRevisited: vi.fn(),
  trackBrandSaved: vi.fn(),
  trackBrandUnsaved: vi.fn(),
  trackProductSaved: vi.fn(),
  trackProductUnsaved: vi.fn(),
}));

vi.mock("@/hooks/use-saved-brands", () => ({
  useSavedBrands: () => ({
    savedIds: new Set<string>(),
    toggle: vi.fn(),
    loading: false,
  }),
}));

// The real SaveBrandButton renders, so the card's stacking classes on it are
// observable; only its context hooks are stubbed (no provider in this tree).
vi.mock("@/hooks/use-saved-products", () => ({
  useSavedProducts: () => ({
    savedIds: new Set<string>(),
    toggle: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/lib/auth/use-user", () => ({
  useUser: () => ({
    user: null,
    loading: false,
    viewer: { isAdmin: false },
    viewerLoading: false,
    viewerError: false,
    refreshViewer: vi.fn(),
  }),
}));

const { BrandCard } = await import("@/components/brands/brand-card");

const THUMBS = [
  "/i/curated-products/a.jpg",
  "/i/curated-products/b.jpg",
  "/i/curated-products/c.jpg",
];

function buildBrand(overrides: Partial<PublicBrandCard> = {}): PublicBrandCard {
  return {
    id: "brand-1",
    name: "山間器物",
    slug: "shanjian",
    description: "手工陶器，日常好用。",
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    heroImageUrl: "/i/brands/shanjian/logo.jpg",
    status: "approved",
    categorySlug: "home",
    categoryLabel: "居家生活",
    subcategories: ["backpacks"],
    subcategoriesEn: ["Backpacks"],
    foundingYear: null,
    city: "taipei",
    productPhotos: [],
    imageAlts: [],
    heroImageMetadata: null,
    ...overrides,
  };
}

function renderCard(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("BrandCard directory variant", () => {
  it("leads with an 80px mark and the brand name as h3 link", () => {
    const { container } = renderCard(<BrandCard brand={buildBrand()} />);

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("山間器物");
    const link = screen.getByRole("link", { name: "山間器物" });
    expect(link).toHaveAttribute("href", "/brands/shanjian");
    expect(heading).toContainElement(link);
    expect(container.querySelector(".h-20.w-20")).not.toBeNull();
  });

  it("shows category · city, omitting city when null", () => {
    const withCity = renderCard(<BrandCard brand={buildBrand()} />);
    expect(screen.getByText("居家生活 · 台北市")).toBeInTheDocument();
    withCity.unmount();

    renderCard(<BrandCard brand={buildBrand({ city: null })} />);
    expect(screen.getByText("居家生活")).toBeInTheDocument();
    expect(screen.queryByText(/·/u)).toBeNull();
  });

  it("shows up to three thumbnails and the count", () => {
    renderCard(
      <BrandCard
        brand={buildBrand()}
        preview={{ count: 7, thumbnails: THUMBS }}
      />,
    );

    const count = screen.getByText("7 件商品");
    const strip = count.parentElement;
    if (!strip) throw new Error("count has no strip");
    const thumbs = strip.querySelectorAll("img");
    expect(thumbs).toHaveLength(3);
    for (const thumb of Array.from(thumbs)) {
      expect(thumb).toHaveAttribute("alt", "");
    }
  });

  it("hides the strip with no preview or count 0", () => {
    const none = renderCard(<BrandCard brand={buildBrand()} />);
    expect(screen.queryByText(/件商品/u)).toBeNull();
    none.unmount();

    renderCard(
      <BrandCard
        brand={buildBrand()}
        preview={{ count: 0, thumbnails: [] }}
      />,
    );
    expect(screen.queryByText(/件商品/u)).toBeNull();
  });

  it("overlays a named save control on the mark, above the whole-card link", () => {
    const { container } = renderCard(<BrandCard brand={buildBrand()} />);

    const save = screen.getByRole("button", { name: "收藏 山間器物" });
    expect(save).toHaveClass("absolute", "z-20");
    const mark = container.querySelector(".h-20.w-20");
    if (!mark?.parentElement) throw new Error("mark has no wrapper");
    expect(mark.parentElement).toContainElement(save);
    expect(
      container.querySelector("[data-auth-required-indicator]"),
    ).toBeNull();
  });

  it("makes the name link cover the whole card", () => {
    renderCard(<BrandCard brand={buildBrand()} />);

    expect(screen.getByRole("link", { name: "山間器物" })).toHaveClass(
      "after:absolute",
      "after:inset-0",
    );
  });

  it("fills its grid cell and pins the strip to the bottom", () => {
    const { container } = renderCard(
      <BrandCard
        brand={buildBrand()}
        preview={{ count: 7, thumbnails: THUMBS }}
      />,
    );

    expect(container.querySelector("article")).toHaveClass("h-full");
    const strip = screen.getByText("7 件商品").parentElement;
    expect(strip).toHaveClass("mt-auto");
  });

  it("renders no badges", () => {
    const { container } = renderCard(<BrandCard brand={buildBrand()} />);

    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
    expect(screen.queryByText("後背包")).toBeNull();
  });
});

describe("BrandCard recommendation variant", () => {
  it("uses the directory layout with the whole card as the only link", () => {
    renderCard(<BrandCard brand={buildBrand()} variant="recommendation" />);

    expect(screen.getByText("手工陶器，日常好用。")).toBeInTheDocument();
    expect(screen.getByText("居家生活 · 台北市")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("山間器物");
    expect(links[0]).toHaveClass("after:absolute", "after:inset-0");
    expect(screen.queryByRole("link", { name: "查看品牌" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("BrandCard hideCategory", () => {
  it("drops the category from the metadata line, keeping the city", () => {
    renderCard(
      <BrandCard brand={buildBrand()} variant="recommendation" hideCategory />,
    );

    expect(screen.getByText("台北市")).toBeInTheDocument();
    expect(screen.queryByText(/居家生活/)).toBeNull();
  });
});

describe("BrandCard editorial variant", () => {
  it("keeps its category badge", () => {
    const editorial = renderCard(
      <BrandCard brand={buildBrand()} variant="editorial" />,
    );
    expect(screen.getByText("居家生活")).toBeInTheDocument();
    expect(
      editorial.container.querySelector('[data-slot="badge"]'),
    ).not.toBeNull();
  });
});
