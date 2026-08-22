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
import type { Event } from "@/lib/services/events";
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
  SavedBrandsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSavedBrands: () => ({ savedIds: new Set<string>(), toggle: vi.fn(), loading: false }),
}));

vi.mock("@/lib/auth/use-user", () => ({
  useUser: () => ({
    user: null,
    loading: false,
    viewer: { hasOwnedBrand: false, isAdmin: false },
    viewerLoading: false,
    viewerError: false,
    refreshViewer: vi.fn(),
  }),
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

function buildWall(count = 2): { slots: WallSlot[] } {
  return {
    slots: Array.from({ length: count }, (_, index) => ({
      kind: "product" as const,
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
      sources: [],
      faq: [],
      sections: [],
      relatedCategories: [],
      relatedStories: [],
      relatedTrails: [],
    },
  } as unknown as TrailEntry;
}

function buildEvent(): Event {
  return {
    id: "event-one",
    slug: "taipei-design-week",
    name: "台北設計週",
    nameEn: "Taipei Design Week",
    summary: "一場設計展",
    summaryEn: "A design fair",
    description: null,
    descriptionEn: null,
    startsOn: "2026-08-10",
    endsOn: "2026-08-20",
  } as unknown as Event;
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
    isVerified: false,
    priceRange: null,
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
    events: [],
    brands: [buildBrand(0), buildBrand(1)],
    ...overrides,
  });

  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {element}
    </NextIntlClientProvider>,
  );
}

function zoneOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[data-landing-zone]")].map(
    (zone) => zone.dataset.landingZone ?? "",
  );
}

describe("landing page trust zones", () => {
  it("opens editorially, then names the labels before it shows the brands", async () => {
    const { container } = await renderZones({
      events: [{ event: buildEvent(), phase: "ongoing", brandCount: 3 }],
    });

    // The approved mock's order, with two zones it does not draw kept in the
    // slot they already occupied: `manifesto` is pinned on `/` by seo.spec.ts,
    // and `topics` is the homepage's only path to a dated event.
    expect(zoneOrder(container)).toEqual([
      "hero",
      "selection",
      "trust",
      "manifesto",
      "topics",
      "directory",
      "close",
    ]);
  });

  it("explains the three labels as prose, never as badges", async () => {
    // D11's contrast rule at its clearest. The band states what 收錄品牌,
    // Formoria 選物 and 品牌提供 each mean in running text; the only rendered
    // trust BADGE in the product lives on brand detail, and putting one here
    // would make the homepage look like it certifies something.
    const { container } = await renderZones();

    const trust = container.querySelector<HTMLElement>(
      '[data-landing-zone="trust"]',
    )!;
    expect(
      within(trust).getByRole("heading", {
        level: 2,
        name: en.landing.trustSeam.line,
      }),
    ).toBeInTheDocument();
    expect(within(trust).getByText(en.landing.trust.note)).toBeInTheDocument();

    for (const [title, body] of [
      [en.landing.trust.listedTitle, en.landing.trust.listedBody],
      [en.landing.trust.selectedTitle, en.landing.trust.selectedBody],
      [en.landing.trust.suppliedTitle, en.landing.trust.suppliedBody],
    ] as const) {
      expect(
        within(trust).getByRole("heading", { level: 3, name: title }),
      ).toBeInTheDocument();
      expect(within(trust).getByText(body)).toBeInTheDocument();
    }

    // `homepage-curated-product.spec.ts` finds the wall by the section whose h2
    // reads exactly "Formoria 選物". The column title here is an h3 for that
    // reason — an h2 would give that selector two matches.
    expect(
      within(trust).queryByRole("heading", {
        level: 2,
        name: en.landing.trust.selectedTitle,
      }),
    ).toBeNull();
  });

  /**
   * The zone used to render only the trails the wall did NOT place. With a
   * single published trail that trail is always a wall tile,
   * so the zone disappeared from the homepage entirely. Its input is now every
   * published trail, and wall placement is not a reason to withhold one: the
   * tile is a picture, the row is the reader's route into /discover.
   */
  it("renders the trails zone when its only trail is also a wall tile", async () => {
    const trail = buildTrail("small-kitchen");
    const { container } = await renderZones({
      // Placed in the wall AND passed to the zone: exactly the single-trail case.
      wall: {
        slots: [
          ...buildWall().slots,
          { kind: "trail" as const, trail, format: "wide" as const },
        ],
      },
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
    ).toHaveAttribute("href", "/discover");

    const rows = within(trails!).getAllByRole("heading", { level: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Trail small-kitchen");
    // /discover, not /stories — the row is `StoryRow` with `hrefBase` repointed.
    expect(
      within(trails!).getByRole("link", { name: /Trail small-kitchen/ }),
    ).toHaveAttribute("href", "/discover/small-kitchen");
  });

  it("renders every published trail in the zone", async () => {
    const placed = buildTrail("small-kitchen");
    const unplaced = buildTrail("first-apartment");
    const { container } = await renderZones({
      wall: {
        slots: [
          ...buildWall().slots,
          { kind: "trail" as const, trail: placed, format: "wide" as const },
        ],
      },
      trails: [placed, unplaced],
    });

    const trails = container.querySelector<HTMLElement>(
      '[data-landing-zone="trails"]',
    )!;
    expect(within(trails).getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(
      within(trails).getByRole("heading", { name: "Trail small-kitchen" }),
    ).toBeInTheDocument();
    expect(
      within(trails).getByRole("heading", { name: "Trail first-apartment" }),
    ).toBeInTheDocument();
  });

  it("omits the trails zone when no trail is published", async () => {
    const { container } = await renderZones({ trails: [] });

    expect(
      container.querySelector('[data-landing-zone="trails"]'),
    ).toBeNull();
    // Not an empty zone wearing the heading either.
    expect(
      screen.queryByRole("heading", { name: en.landing.trails.heading }),
    ).toBeNull();
  });

  it("keeps the zone order", async () => {
    const { container } = await renderZones({
      trails: [buildTrail("small-kitchen")],
      events: [{ event: buildEvent(), phase: "ongoing", brandCount: 3 }],
    });

    expect(zoneOrder(container)).toEqual([
      "hero",
      "selection",
      "trust",
      "trails",
      "manifesto",
      "topics",
      "directory",
      "close",
    ]);
  });

  it("renders one brand rail, not two", async () => {
    const { container } = await renderZones();

    expect(container.querySelectorAll('[data-landing-zone="directory"]')).toHaveLength(1);
    // `level: 2`, and the query stays page-wide so a rail smuggled into any
    // zone is still caught. The level is what makes that possible: the trust
    // band's first column is titled with the SAME words — "Listed brands" is
    // the trust label itself, so the glossary entry that defines it and the
    // rail that heads a list of them read identically — but it is an `h3`
    // under the band's own `h2`, and it is not a rail. Matching on text alone
    // counted the definition as a second rail.
    expect(
      screen.getAllByRole("heading", {
        name: en.landing.showcase.heading,
        level: 2,
      }),
    ).toHaveLength(1);

    // The new-brands rail is gone with its copy: its two keys were deleted in
    // Wave 1, so a surviving second rail would render a missing-message error.
    expect(container.innerHTML).not.toContain("newBrands");
  });

  it("lifts a promoted event above stories when one is live", async () => {
    const { container } = await renderZones({
      events: [{ event: buildEvent(), phase: "ongoing", brandCount: 3 }],
      stories: [buildStory("a-story")],
    });

    const topics = container.querySelector<HTMLElement>('[data-landing-zone="topics"]')!;
    const eventHeading = within(topics).getByRole("heading", {
      name: "Taipei Design Week",
    });
    const storyHeading = within(topics).getByRole("heading", {
      name: "Story a-story",
    });

    // Node.DOCUMENT_POSITION_FOLLOWING — the event precedes the story.
    expect(
      eventHeading.compareDocumentPosition(storyHeading) & 4,
    ).toBeTruthy();

    const withoutEvent = await renderZones({ events: [] });
    const storiesOnly = withoutEvent.container.querySelector<HTMLElement>(
      '[data-landing-zone="topics"]',
    )!;
    expect(
      within(storiesOnly).queryByRole("heading", { name: "Taipei Design Week" }),
    ).toBeNull();
    expect(
      within(storiesOnly).getByRole("heading", { name: "Story a-story" }),
    ).toBeInTheDocument();
  });

  it("names the topics zone after what it actually contains", async () => {
    const { container } = await renderZones({
      events: [{ event: buildEvent(), phase: "ongoing", brandCount: 3 }],
      stories: [],
    });

    const topics = container.querySelector<HTMLElement>(
      '[data-landing-zone="topics"]',
    )!;
    // With no published story the zone holds only events, so heading, link and
    // landmark name must say so — not "Stories" over a list of events.
    expect(
      within(topics).getByRole("heading", {
        level: 2,
        name: en.landing.events.heading,
      }),
    ).toBeInTheDocument();
    expect(
      within(topics).queryByRole("heading", {
        level: 2,
        name: en.landing.latestStories.heading,
      }),
    ).toBeNull();
    expect(
      within(topics).getByRole("link", { name: en.landing.events.linkText }),
    ).toHaveAttribute("href", "/events");
    expect(
      within(topics).queryByRole("link", {
        name: en.landing.latestStories.linkText,
      }),
    ).toBeNull();
  });

  it("renders the manifesto photo band in the seam slot", async () => {
    // Restored 2026-08-17, reversing the DEV-1479 recut that put the thin trust
    // seam here. The trust line itself now ships only on /about, /faq and the
    // /og/trust card — asserted in the i18n spec, not here.
    const { container } = await renderZones();

    // The zone is named for what it renders. It briefly carried
    // `data-landing-zone="seam"` after the band was restored into the slot the
    // trust seam had occupied, which made the selector a lie.
    const seam = container.querySelector<HTMLElement>(
      '[data-landing-zone="manifesto"]',
    )!;
    expect(
      within(seam).getByRole("heading", { name: en.landing.manifesto.headline }),
    ).toBeInTheDocument();
    expect(within(seam).getByText(en.landing.manifesto.body1)).toBeInTheDocument();
    expect(within(seam).getByText(en.landing.manifesto.body2)).toBeInTheDocument();
    expect(
      within(seam).getByRole("link", { name: en.landing.manifesto.cta }),
    ).toHaveAttribute("href", "/about");

    // The photograph is decorative and must not preload — the hero owns that.
    const image = seam.querySelector("img")!;
    expect(image.getAttribute("src")).toContain("manifesto-bg");
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("data-priority")).toBe("false");
  });

  it("omits the brand-count figure", async () => {
    const { container } = await renderZones();

    const directory = container.querySelector<HTMLElement>(
      '[data-landing-zone="directory"]',
    )!;
    // The stat line sat directly above the rail. Nothing in the rail counts.
    expect(directory.textContent ?? "").not.toMatch(/\d/);
  });

  it("keeps the degraded-render wiring intact", () => {
    const healthy = {
      exploreResult: { brands: [], totalCount: 0 },
      curatedProducts: [],
      stories: { ok: true as const },
      trails: { ok: true as const },
      events: [],
      eventBrandCounts: null,
      promotedEventCount: 0,
    };

    // `trailSupply` is not an input at all: a failed supply read hides the
    // trail tile and must never demote `/` to dynamic for the whole deployment.
    expect(isLandingRenderDegraded(healthy)).toBe(false);

    expect(isLandingRenderDegraded({ ...healthy, exploreResult: null })).toBe(true);
    expect(isLandingRenderDegraded({ ...healthy, curatedProducts: null })).toBe(true);
    expect(isLandingRenderDegraded({ ...healthy, stories: { ok: false } })).toBe(true);
    expect(isLandingRenderDegraded({ ...healthy, trails: null })).toBe(true);
    expect(isLandingRenderDegraded({ ...healthy, trails: { ok: false } })).toBe(true);
    expect(isLandingRenderDegraded({ ...healthy, events: null })).toBe(true);
    expect(
      isLandingRenderDegraded({
        ...healthy,
        promotedEventCount: 2,
        eventBrandCounts: null,
      }),
    ).toBe(true);

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
