/**
 * @vitest-environment jsdom
 */
import type { ComponentProps, ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { scrimBackgroundImage } from "@/lib/design/photo-band-scrims";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../../messages/en.json";
import { buildWebSiteJsonLd } from "@/lib/json-ld";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";

// The opener renders no image at all now, but the mock stays: a regression that
// puts a photograph back would otherwise die inside getImgProps on jsdom's
// missing loader base URL rather than on the assertion that names the rule.
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

describe("HeroSection — the editorial opener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ results: [] }) }),
    ) as unknown as typeof fetch;
  });

  it("opens editorially with search retained", async () => {
    // D1/D18. The opener is an eyebrow, the promise line, a lede and a search
    // field — the two halves this asserts together, because either one alone
    // has shipped before: a text-only hero with no way to search, and a search
    // bar with no point of view above it.
    await renderHero();

    expect(screen.getByText(en.landing.hero.eyebrow)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: en.landing.hero.headline }),
    ).toBeInTheDocument();
    expect(screen.getByText(en.landing.hero.lede)).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("renders the photograph as a scrimmed background, not a block in the flow", async () => {
    // ROUND EIGHT, AND THE CONSTRUCTION IS THE ASSERTION. The image has been
    // added and removed four times (2026-08-17 added above the text,
    // 2026-08-19 removed, DEV-1544 restored above, removed again, then placed
    // below). Every one of those put it in the document flow as a block of its
    // own, where it read as a second picture competing with the wall of
    // product photographs one viewport down. It is a BACKGROUND now: the text
    // sits on top of it behind a scrim, the same construction as the manifesto
    // band in `landing-zones.tsx`.
    //
    // The VARIANT is asserted, not an opacity: the stops belong to
    // `@/lib/design/photo-band-scrims` and the numbers are proved against this
    // photograph's real pixels by `scripts/check-photo-band-contrast.ts` on
    // every `pnpm lint`. What this test owns is that the opener asks for the
    // left-weighted scrim at all — the copy here is left-aligned, and a
    // centred or flat scrim over it either bleaches the photograph (the flat
    // `/85` this shipped with for one afternoon) or shadows one side.
    //
    // `priority` is asserted, not incidental. Both `landing-zones.tsx` and
    // `selected-product-tile.tsx` withhold `priority` "because the photograph
    // in the opener owns the preload". If this assertion is ever deleted,
    // those two comments become lies again.
    const { container } = await renderHero();

    const hero = container.querySelector("img");
    expect(hero).not.toBeNull();
    expect(hero).toHaveAttribute("src", expect.stringContaining("home-hero"));
    expect(hero).toHaveAttribute("data-priority", "true");

    const scrim = container.querySelector<HTMLElement>(".absolute.inset-0");
    expect(scrim?.style.backgroundImage).toBe(scrimBackgroundImage("left"));

    // The heading is not inside the image's box — it is a sibling layer above
    // the scrim, which is what "background" means here.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(hero!.contains(heading)).toBe(false);
  });

  it("keeps the photograph decorative", async () => {
    // `alt=""` follows story and trail detail: the `<h1>` above states the
    // promise, and a screen reader repeating it as image text is noise. This
    // is also why no `landing.hero.alt` message key exists — if descriptive
    // alt is ever wanted, it has to land in BOTH locale catalogues.
    const { container } = await renderHero();

    expect(container.querySelector("img")).toHaveAttribute("alt", "");
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
    // the opener's form must submit into the same path and query parameter.
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
    // Google lifts a rotating brand blurb as the homepage snippet. It is also
    // asserted verbatim by seo.spec.ts, so it cannot be folded into the lede.
    const { container } = await renderHero();

    const paragraphs = [...container.querySelectorAll("p")];
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(paragraphs[0]).toHaveTextContent(en.landing.hero.subheadline);
  });

  it("hero category chips are gone", async () => {
    // The whole L1 row moved into the persistent nav (D18), which is why
    // `hero-category-chips.tsx` was deleted rather than restyled. A chip row
    // returning here would put thirteen duplicate category links one viewport
    // under the thirteen in the header.
    const { container } = await renderHero();

    for (const category of L1_CATEGORIES) {
      expect(
        container.querySelector(`a[href="/categories/${category.slug}"]`),
        `chip for ${category.slug}`,
      ).toBeNull();
    }
    expect(container.querySelectorAll("nav")).toHaveLength(0);
  });

  it("offers one secondary path beside the search field", async () => {
    const { container } = await renderHero();

    const secondary = screen.getByRole("link", {
      name: new RegExp(en.landing.hero.browseCta),
    });
    // /discover, not an in-page `#` anchor: the 風格 zone below is withheld
    // when nothing is published, and a fragment with no target is a dead
    // control that still looks live.
    expect(secondary).toHaveAttribute("href", "/discover");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("publishes no hero sentinel", async () => {
    // `[data-hero-sentinel]` existed for exactly one reader: the header's
    // IntersectionObserver, which revealed the nav search once the hero left
    // the viewport. The nav search is unconditional now, so both sides go.
    const { container } = await renderHero();

    expect(container.querySelector("[data-hero-sentinel]")).toBeNull();
  });
});
