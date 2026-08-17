/**
 * @vitest-environment jsdom
 */
import type { ComponentProps, ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../../messages/en.json";
import { buildWebSiteJsonLd } from "@/lib/json-ld";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";

// The hero carries a `priority` background photograph. `next/image` resolves a
// local `src` against the loader's base URL, which jsdom does not provide, so
// without this every spec in this file dies on "Invalid URL" inside getImgProps.
// `priority` is surfaced as a data attribute because React drops the unknown
// boolean prop from a plain `<img>`.
vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority, ...props }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
    <img alt="" data-priority={priority ? "true" : "false"} {...props} />
  ),
}));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../../messages/en.json")).default;

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

const mockPush = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-filter-params", () => ({
  useFilterParams: () => ({
    filters: { search: "" },
    isPending: false,
    setSearch: vi.fn(),
  }),
}));

vi.mock("@/lib/analytics", () => ({
  trackSearchExecuted: vi.fn(),
  trackSearchResultClicked: vi.fn(),
  trackSearchSuggestionSelect: vi.fn(),
  trackHeroCategoryClicked: vi.fn(),
}));

const HeroSection = (await import("../hero-section")).default;

type ProviderMessages = ComponentProps<
  typeof NextIntlClientProvider
>["messages"];

async function renderHero(messages: ProviderMessages = en) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {await HeroSection()}
    </NextIntlClientProvider>,
  );
}

/** jsdom refuses a real navigation, so the assignment target is captured. */
function stubLocation(): { current: string } {
  const captured = { current: "" };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      get href() {
        return captured.current;
      },
      set href(value: string) {
        captured.current = value;
      },
    },
  });
  return captured;
}

describe("HeroSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ results: [] }) }),
    ) as unknown as typeof fetch;
  });

  it("renders the background photograph, decorative and preloaded", async () => {
    // REVERSES DEV-1479 decision D2 ("the hero is photograph-free"), by product
    // decision on 2026-08-17: production never stopped serving this image and
    // the text-only hero read as unfinished above a wall of photographs.
    const { container } = await renderHero();

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toContain("hero-bg");
    // Decorative: the headline beside it carries the meaning.
    expect(image?.getAttribute("alt")).toBe("");
    // It is the LCP element, so it preloads — and it is the ONLY image on the
    // page that does. `selected-product-tile.tsx` marks no wall tile
    // `priority`, so nothing competes with this request.
    expect(image?.getAttribute("data-priority")).toBe("true");
  });

  it("renders exactly one search control that targets /brands?search=", async () => {
    const target = stubLocation();
    await renderHero();

    const forms = screen.getAllByRole("search");
    expect(forms).toHaveLength(1);

    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "teapot{Enter}");

    await waitFor(() => {
      expect(target.current).not.toBe("");
    });

    // The WebSite JSON-LD promises search engines this exact entry point, so
    // the hero form must submit into the same path and query parameter.
    const urlTemplate = (
      buildWebSiteJsonLd("en").potentialAction as {
        target: { urlTemplate: string };
      }
    ).target.urlTemplate;
    const declaredPath = new URL(urlTemplate).pathname;

    const submitted = new URL(target.current, "http://localhost");
    expect(submitted.pathname.endsWith(declaredPath)).toBe(true);
    expect(submitted.searchParams.get("search")).toBe("teapot");
  });

  it("subheadline is the first prose node in the DOM", async () => {
    // DEV-1320: the earliest body text on `/` must be the positioning line, or
    // Google lifts a rotating brand blurb as the homepage snippet.
    const { container } = await renderHero();

    const paragraphs = [...container.querySelectorAll("p")];
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs[0]).toHaveTextContent(en.landing.hero.subheadline);
  });

  it("the mobile chip row stays left-aligned and horizontally scrollable", async () => {
    const { container } = await renderHero();

    const scrollable = [...container.querySelectorAll("nav")].find((nav) =>
      nav.className.includes("overflow-x-auto"),
    );
    expect(scrollable).toBeDefined();

    // A centred row that overflows reads as broken and loses its scroll
    // affordance, so only the desktop block (which never overflows) centres.
    expect(scrollable!.className).not.toContain("text-center");
    expect(scrollable!.className).not.toContain("justify-center");
  });

  it("every L1 category is reachable from the hero, with no all-categories link", async () => {
    // The header drops its category tab row on `/`, so the hero is the only
    // category entry point and must list the ontology in full.
    const { container } = await renderHero();

    for (const category of PRODUCT_TYPE_CATEGORIES) {
      const chips = container.querySelectorAll(
        `a[href="/categories/${category.slug}"]`,
      );
      // One chip in the desktop block, one in the mobile scroller.
      expect(chips).toHaveLength(2);
      expect(chips[0]).toHaveTextContent(category.name);
    }

    // Every category is on screen, so the escape hatch to /brands is dead
    // weight — the only remaining /brands link is the browse CTA.
    const brandsLinks = container.querySelectorAll('a[href="/brands"]');
    expect(brandsLinks).toHaveLength(1);
    expect(brandsLinks[0]).toHaveTextContent(en.landing.hero.browseCta);
  });

  it("labels the desktop chip block with the eyebrow line", async () => {
    const { container } = await renderHero();

    const desktopNav = [...container.querySelectorAll("nav")].find(
      (nav) => !nav.className.includes("overflow-x-auto"),
    );
    expect(desktopNav).toBeDefined();
    expect(desktopNav!).toHaveTextContent(en.landing.hero.categoriesEyebrow);

    // ONE wrapping row, not a hand-split 6+6: zh-TW's twelve four-character
    // labels fit a single line at the 1120px cap, and EN's word labels wrap to
    // a second by themselves. Asserting one container with all twelve chips
    // keeps this test about "every category is reachable" rather than about a
    // row count that legitimately differs per locale and viewport.
    const rows = [...desktopNav!.querySelectorAll("div")].filter((row) =>
      row.className.includes("justify-center"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelectorAll("a")).toHaveLength(
      PRODUCT_TYPE_CATEGORIES.length,
    );
  });

  it("keeps a single h1", async () => {
    const { container } = await renderHero();

    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(en.landing.hero.headline);
  });
});
