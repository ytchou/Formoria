/* eslint-disable @next/next/no-html-link-for-pages -- test mocks use raw <a> tags */
/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import type { PublicBrandCard } from "@/lib/brands/contracts";
import type { WallSlot } from "@/lib/curated-products/home-wall";
import type { HomepageCuratedProduct } from "@/lib/services/curated-products";
import type { StoryEntry } from "@/lib/services/stories";
import type { TrailEntry } from "@/lib/services/trails";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/en.json")).default;

  type TranslatorOptions = Parameters<typeof createTranslator>[0];

  return {
    getLocale: async () => "en",
    getTranslations: async (
      options?: string | { locale?: string; namespace?: string },
    ) =>
      createTranslator({
        locale: "en",
        messages,
        namespace: typeof options === "string" ? options : options?.namespace,
      } as unknown as TranslatorOptions),
  };
});

// `priority` is surfaced as a data attribute rather than dropped: the seam spec
// asserts the manifesto band does NOT preload, since the hero photograph owns
// the single above-the-fold preload. React would drop the unknown boolean prop
// from a plain `<img>`.
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority, ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
    <img alt="" data-priority={priority ? "true" : "false"} {...props} />
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
  trackBrandSaved: vi.fn(),
  trackBrandUnsaved: vi.fn(),
  trackCtaClicked: vi.fn(),
  trackCuratedProductClicked: vi.fn(),
  trackExternalLinkClicked: vi.fn(),
  trackRecommendationBrandClicked: vi.fn(),
  trackSavedBrandRevisited: vi.fn(),
  trackStockistListViewed: vi.fn(),
  trackStoryCardClicked: vi.fn(),
  trackTrailCardClicked: vi.fn(),
  trackViewItemList: vi.fn(),
}));

// The rail's cards read viewer state through these two hooks. Both are context
// consumers that throw outside their provider, and neither is what this suite
// is about — page.tsx still wraps the rail in the real `SavedBrandsProvider`,
// which the verification rubric checks by reading the source.
vi.mock("@/hooks/use-saved-brands", () => ({
  SavedBrandsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useSavedBrands: () => ({
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

// The new async server components call `getTranslations` internally, and the
// client TrailCarousel depends on embla-carousel which needs a real DOM.
// Mock them so the zone-structure assertions stay fast and deterministic.
vi.mock("@/components/landing/curated-product-grid", () => ({
  CuratedProductGrid: ({ slots }: { slots: unknown[] }) => (
    <div data-testid="curated-product-grid">{slots.length} products</div>
  ),
}));

vi.mock("@/components/landing/trail-carousel", () => ({
  default: ({
    trails,
    labels,
  }: {
    trails: { slug: string; frontmatter: { title: string } }[];
    labels: { eyebrow: string; cta: string; prev: string; next: string };
  }) => (
    <ul data-testid="trail-carousel">
      {trails.map((trail) => (
        <li key={trail.slug} role="listitem">
          <a href={`/style/${trail.slug}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- test mock */}
            <img src="/stub.webp" alt={trail.frontmatter.title} />
            <h3>{trail.frontmatter.title}</h3>
          </a>
          <span>{labels.eyebrow}</span>
        </li>
      ))}
    </ul>
  ),
}));

vi.mock("@/components/landing/brand-strip", () => ({
  default: ({
    brands,
    totalCount,
  }: {
    brands: { id: string; name: string }[];
    totalCount: number;
  }) => (
    <div data-testid="brand-strip">
      <h2>{en.landing.brands.count.replace("{count}", String(totalCount))}</h2>
      <span>{brands.length} brands</span>
      <a href="/brands">{en.landing.brands.browseAll}</a>
    </div>
  ),
}));

vi.mock("@/components/landing/mission-closer", () => ({
  default: ({ brandCount }: { brandCount: number }) => (
    <div data-testid="mission-closer">
      <h2>{en.landing.missionCloser.headline}</h2>
      <p>
        {en.landing.missionCloser.subtitle.replace(
          "{count}",
          String(brandCount),
        )}
      </p>
      <a href="/brands">{en.landing.missionCloser.cta}</a>
    </div>
  ),
}));

const { LandingZones } = await import("@/components/landing/landing-zones");
const { isLandingRenderDegraded } = await import("@/app/[locale]/(site)/page");

/**
 * Editorial copy rather than `Product 1`: the zone assertions below read real
 * text out of the DOM, and uniform ASCII hides the CJK wrapping and long-string
 * truncation this page is most exposed to. One entry deliberately has no
 * English copy, which is how the tile renders its zh-TW name in the `en` locale.
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
      "洗過幾次之後才會出現的柔軟，是這塊布最好的時候；長度足夠蓋住六人餐桌的兩側。",
    descriptionEn: null,
    brandName: "本嶼織物",
  },
];

function buildProduct(index: number): HomepageCuratedProduct {
  const fixture = WALL_FIXTURES[index % WALL_FIXTURES.length]!;
  return {
    id: `product-${index}`,
    brandId: `brand-${index}`,
    key: `product-${index}`,
    nameZh: `${fixture.nameZh}／${index}`,
    nameEn: fixture.nameEn ? `${fixture.nameEn}／${index}` : null,
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

function buildWall(count = 2): { slots: WallSlot[] } {
  return {
    slots: Array.from({ length: count }, (_, index) => ({
      product: buildProduct(index),
      ratio: "4:3" as const,
    })),
  };
}

function buildStory(slug: string): StoryEntry {
  return {
    slug,
    frontmatter: {
      title: `Story ${slug}`,
      description: "A story about a maker.",
      slug,
      tags: [],
      locale: "en",
      publishedAt: "2026-01-01",
      draft: false,
      sources: [],
      faq: [],
      sections: [],
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
    },
  } as unknown as StoryEntry;
}

function buildTrail(slug: string): TrailEntry {
  return {
    slug,
    frontmatter: {
      title: `Trail ${slug}`,
      description: "Where to start when the kitchen is small.",
      slug,
      tags: [],
      locale: "en",
      publishedAt: "2026-02-01",
      draft: false,
      heroImage: `/images/trails/${slug}.webp`,
      heroImageAlt: `Objects arranged for ${slug}`,
      sources: [],
      faq: [],
      sections: [],
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
    },
  } as unknown as TrailEntry;
}

function buildBrand(index: number): PublicBrandCard {
  return {
    id: `brand-${index}`,
    name: `Brand ${String.fromCharCode(65 + index)}`,
    slug: `brand-${index}`,
    description: "A maker of quiet things.",
    descriptionEn: "A maker of quiet things.",
    blurb: null,
    blurbEn: null,
    heroImageUrl: null,
    status: "approved",
    category: "home",
    subcategories: [],
    subcategoriesEn: [],
    foundingYear: null,
    productPhotos: [],
    imageAlts: [],
    heroImageMetadata: null,
  } as unknown as PublicBrandCard;
}

type ZoneOverrides = Partial<Parameters<typeof LandingZones>[0]>;

async function renderZones(overrides: ZoneOverrides = {}) {
  const element = await LandingZones({
    locale: "en",
    hero: <section>Hero</section>,
    close: <section>Close</section>,
    wall: buildWall(),
    trails: [],
    stories: [buildStory("a-story")],
    brands: [buildBrand(0), buildBrand(1)],
    totalBrandCount: 700,
    ...overrides,
  });

  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {element}
    </NextIntlClientProvider>,
  );
}

function zoneOrder(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-landing-zone]"),
  ].map((zone) => zone.dataset.landingZone ?? "");
}

describe("landing page zones", () => {
  // Bug caught: the homepage can silently regrow the trust glossary or move
  // the remaining landmarks while still rendering plausible copy.
  it("omits the trust glossary and keeps the remaining zones ordered", async () => {
    const { container } = await renderZones();

    expect(zoneOrder(container)).toEqual([
      "hero",
      "selection",
      "manifesto",
      "topics",
      "directory",
      "close",
    ]);
    expect(container.querySelector('[data-landing-zone="trust"]')).toBeNull();
  });

  it("renders the trails zone when only one trail is published", async () => {
    const trail = buildTrail("small-kitchen");
    const { container } = await renderZones({
      trails: [trail],
    });

    const trails = container.querySelector<HTMLElement>(
      '[data-landing-zone="trails"]',
    );
    expect(trails).not.toBeNull();
    expect(
      within(trails!).getByRole("heading", {
        level: 2,
        name: en.landing.trails.heading,
      }),
    ).toBeInTheDocument();
    expect(
      within(trails!).getByRole("link", { name: en.landing.trails.linkText }),
    ).toHaveAttribute("href", "/style");

    const headings = within(trails!).getAllByRole("heading", { level: 3 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Trail small-kitchen");
    expect(
      within(trails!).getByRole("link", { name: /Trail small-kitchen/ }),
    ).toHaveAttribute("href", "/style/small-kitchen");
  });

  it("renders every published trail as a card in the zone", async () => {
    const first = buildTrail("small-kitchen");
    const second = buildTrail("first-apartment");
    const { container } = await renderZones({
      trails: [first, second],
    });

    const trails = container.querySelector<HTMLElement>(
      '[data-landing-zone="trails"]',
    )!;
    const cards = within(trails).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(within(card).getByRole("img")).toBeInTheDocument();
      expect(
        within(card).getByRole("heading", { level: 3 }),
      ).toBeInTheDocument();
    }
  });

  it("keeps a level-3 heading per trail", async () => {
    const { container } = await renderZones({
      trails: [buildTrail("small-kitchen"), buildTrail("first-apartment")],
    });

    const trails = container.querySelector<HTMLElement>(
      '[data-landing-zone="trails"]',
    )!;
    expect(within(trails).getAllByRole("heading", { level: 3 })).toHaveLength(
      2,
    );
  });

  it("omits the trails zone when no trail is published", async () => {
    const { container } = await renderZones({ trails: [] });

    expect(container.querySelector('[data-landing-zone="trails"]')).toBeNull();
    // Not an empty zone wearing the heading either.
    expect(
      screen.queryByRole("heading", { name: en.landing.trails.heading }),
    ).toBeNull();
  });

  it("keeps the zone order", async () => {
    const { container } = await renderZones({
      trails: [buildTrail("small-kitchen")],
    });

    expect(zoneOrder(container)).toEqual([
      "hero",
      "selection",
      "trails",
      "manifesto",
      "topics",
      "directory",
      "close",
    ]);
  });

  it("renders one brand strip, not two", async () => {
    const { container } = await renderZones();

    expect(
      container.querySelectorAll('[data-landing-zone="directory"]'),
    ).toHaveLength(1);
    // BrandStrip replaced BrandShowcase; verify the count heading renders.
    expect(screen.getByTestId("brand-strip")).toBeInTheDocument();

    // The new-brands rail is gone with its copy: its two keys were deleted in
    // Wave 1, so a surviving second rail would render a missing-message error.
    expect(container.innerHTML).not.toContain("newBrands");
  });

  it("renders MissionCloser in the manifesto zone", async () => {
    const { container } = await renderZones();

    const manifesto = container.querySelector<HTMLElement>(
      '[data-landing-zone="manifesto"]',
    )!;
    expect(manifesto).not.toBeNull();
    expect(
      within(manifesto).getByRole("heading", {
        name: en.landing.missionCloser.headline,
      }),
    ).toBeInTheDocument();
    expect(
      within(manifesto).getByRole("link", {
        name: en.landing.missionCloser.cta,
      }),
    ).toHaveAttribute("href", "/brands");
  });

  it("renders the brand count in the directory zone", async () => {
    const { container } = await renderZones({ totalBrandCount: 700 });

    const directory = container.querySelector<HTMLElement>(
      '[data-landing-zone="directory"]',
    )!;
    // BrandStrip now renders a count line — verify it appears.
    expect(directory.textContent).toContain("700");
  });

  it("keeps the degraded-render wiring intact", () => {
    const healthy = {
      exploreResult: { brands: [], totalCount: 0 },
      curatedProducts: [],
      stories: { ok: true as const },
      trails: { ok: true as const },
    };

    // `trailSupply` is not an input at all: a failed supply read hides the
    // trail tile and must never demote `/` to dynamic for the whole deployment.
    expect(isLandingRenderDegraded(healthy)).toBe(false);

    expect(isLandingRenderDegraded({ ...healthy, exploreResult: null })).toBe(
      true,
    );
    expect(isLandingRenderDegraded({ ...healthy, curatedProducts: null })).toBe(
      true,
    );
    expect(
      isLandingRenderDegraded({ ...healthy, stories: { ok: false } }),
    ).toBe(true);
    expect(isLandingRenderDegraded({ ...healthy, trails: null })).toBe(true);
    expect(isLandingRenderDegraded({ ...healthy, trails: { ok: false } })).toBe(
      true,
    );

    const source = readFileSync(
      resolve(import.meta.dirname, "../../app/[locale]/(site)/page.tsx"),
      "utf8",
    );
    // Both markers must exist before slicing: `indexOf` returns -1 for a
    // missing one, and the slice still yields a non-empty string — so the
    // guard below would pass against a page.tsx that no longer computes
    // `degraded` at all.
    const start = source.indexOf("const degraded =");
    const end = source.indexOf("if (degraded)");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const statement = source.slice(start, end);
    expect(statement).not.toContain("trailSupply");
  });
});
