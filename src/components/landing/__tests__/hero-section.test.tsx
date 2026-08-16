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

  it("renders no background image", async () => {
    const { container } = await renderHero();

    // `next/image` always emits an <img>; the decorative scrim it sat under is
    // gone with it. The hero is photograph-free by design (D2).
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("hero-bg");
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

  it("category chips remain left-aligned and horizontally scrollable", async () => {
    const { container } = await renderHero();

    const navs = [...container.querySelectorAll("nav")];
    expect(navs.length).toBeGreaterThan(0);

    for (const nav of navs) {
      // Centring the hero is visual and stops at the control group — a centred
      // chip row that overflows reads as broken and loses its scroll affordance.
      expect(nav.className).not.toContain("text-center");
      expect(nav.className).not.toContain("justify-center");
    }

    const scrollable = navs.find((nav) =>
      nav.className.includes("overflow-x-auto"),
    );
    expect(scrollable).toBeDefined();
  });

  it("keeps a single h1", async () => {
    const { container } = await renderHero();

    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(en.landing.hero.headline);
  });
});
