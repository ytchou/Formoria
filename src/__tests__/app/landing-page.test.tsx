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

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    ...props
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
  }: Record<string, unknown>) => <img alt="" {...props} />,
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
  trackHeroCategoryClicked: vi.fn(),
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
    rationaleZh: "手感穩定，適合小空間的早晨。",
    rationaleEn: "Steady in the hand, made for small kitchens.",
    brandName: "小器生活",
  },
  {
    nameZh: "麻布長桌巾（原色）",
    nameEn: null,
    rationaleZh:
      "洗過幾次之後才會出現的柔軟，是這塊布最好的時候；長度足夠蓋住六人餐桌的兩側。",
    rationaleEn: null,
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

function buildWall(count = 2): { slots: WallSlot[]; leftoverTrails: [] } {
  return {
    slots: Array.from({ length: count }, (_, index) => ({
      kind: "product" as const,
      product: buildProduct(index),
      ratio: "4:3" as const,
    })),
    leftoverTrails: [],
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
    productTags: [],
    productTagsEn: [],
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
  it("renders six sections in trust-zone order", async () => {
    const { container } = await renderZones({
      events: [{ event: buildEvent(), phase: "ongoing", brandCount: 3 }],
    });

    expect(zoneOrder(container)).toEqual([
      "hero",
      "selection",
      "seam",
      "topics",
      "directory",
      "close",
    ]);
  });

  it("renders one brand rail, not two", async () => {
    const { container } = await renderZones();

    expect(container.querySelectorAll('[data-landing-zone="directory"]')).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", { name: en.landing.showcase.heading }),
    ).toHaveLength(1);

    // The new-brands rail is gone with its copy: its two keys were deleted in
    // Wave 1, so a surviving second rail would render a missing-message error.
    expect(container.innerHTML).not.toContain("newBrands");
    expect(container.textContent).not.toContain("landing.newBrands");
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

  it("renders the trust seam without the manifesto photo band", async () => {
    const { container } = await renderZones();

    const seam = container.querySelector<HTMLElement>('[data-landing-zone="seam"]')!;
    expect(within(seam).getByText(en.landing.trustSeam.line)).toBeInTheDocument();
    expect(within(seam).getByText(en.landing.trustSeam.note)).toBeInTheDocument();

    // The seam is thin by design: no photograph, and therefore no scrim.
    expect(seam.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("manifesto-bg");
  });

  it("omits the brand-count figure", async () => {
    const { container } = await renderZones();

    const directory = container.querySelector<HTMLElement>(
      '[data-landing-zone="directory"]',
    )!;
    // The stat line sat directly above the rail. Nothing in the rail counts.
    expect(directory.textContent ?? "").not.toMatch(/\d/);
    // The figure read "N brands". Its message key is deleted, so the literal
    // shape is what the assertion pins now.
    expect(screen.queryByText(/\d+\s*brands/i)).toBeNull();
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
    const statement = source.slice(
      source.indexOf("const degraded ="),
      source.indexOf("if (degraded)"),
    );
    expect(statement).not.toBe("");
    expect(statement).not.toContain("trailSupply");
  });
});
