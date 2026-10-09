// @vitest-environment jsdom
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";
import type { Brand } from "@/lib/types";

/**
 * `BrandLine` is the one brand shortcode with a second, unlinked form: a row
 * authored with `name` renders as plain text when there is no directory listing
 * to link to. The missing-brand notice is an authoring aid (dev and staging);
 * production must never show readers a raw slug (DEV-1963).
 *
 * The lookup arrives through the `loadBrands` seam, not a module mock —
 * `scripts/check-test-boundaries.mjs` forbids mocking `@/lib/services/*`.
 */
const loadBrands = vi.fn<(slugs: string[]) => Promise<Map<string, Brand>>>();

// Delegates to next-intl's real translator against `messages/en.json`, the
// same shape as the sibling shortcode suites.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../../messages/en.json")).default;

  type TranslatorOptions = Parameters<typeof createTranslator>[0];

  const getTranslations = async (
    options?: string | { locale?: string; namespace?: string },
  ) =>
    createTranslator({
      locale: typeof options === "string" ? "en" : (options?.locale ?? "en"),
      messages,
      namespace: typeof options === "string" ? options : options?.namespace,
    } as unknown as TranslatorOptions);

  return {
    getLocale: async () => "en",
    getTranslations,
  };
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Omit<ComponentPropsWithoutRef<"a">, "href" | "children">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/analytics", () => ({
  trackBrandCardClicked: vi.fn(),
}));

import { BrandLine } from "../brand-list";

function makeBrand(slug: string, name: string): Brand {
  return {
    id: `id-${slug}`,
    name,
    slug,
    status: "approved",
    categorySlug: "bags-accessories",
    categoryLabel: "Bags & Accessories",
    heroImageUrl: null,
    productPhotos: [],
    imageAlts: [],
    blurb: "Directory blurb",
    blurbEn: "Directory blurb",
    description: null,
    descriptionEn: null,
    subcategories: [],
    subcategoriesEn: [],
  } as unknown as Brand;
}

function stubProduction() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FORMORIA_DEPLOYMENT_ENV", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "");
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENV", "");
}

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("BrandLine", () => {
  beforeEach(() => {
    loadBrands.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("links the resolved brand by its directory name", async () => {
    loadBrands.mockResolvedValue(
      new Map([["molasses", makeBrand("molasses", "Molasses")]]),
    );

    renderWithIntl(
      await BrandLine({ slug: "molasses", name: "Ignored", loadBrands }),
    );

    expect(screen.getByRole("link", { name: "Molasses" })).toHaveAttribute(
      "href",
      "/brands/molasses",
    );
    expect(screen.queryByText("Ignored")).toBeNull();
  });

  // DS2-34: the name alone is a ~20px target. The link's overlay stretches it
  // across a row at least 44px tall, the brand-card pattern.
  it("stretches the brand link across a 44px row", async () => {
    loadBrands.mockResolvedValue(
      new Map([["molasses", makeBrand("molasses", "Molasses")]]),
    );

    renderWithIntl(await BrandLine({ slug: "molasses", loadBrands }));

    const link = screen.getByRole("link", { name: "Molasses" });
    expect(link.className).toContain("after:inset-0");
    const row = link.parentElement;
    expect(row?.className).toContain("relative");
    expect(row?.className).toContain("min-h-11");
  });

  it("renders a name-only row as plain text without calling the loader", async () => {
    renderWithIntl(
      await BrandLine({
        name: "Corner Studio",
        booth: "A-12",
        note: "Hand-bound notebooks.",
        loadBrands,
      }),
    );

    expect(loadBrands).not.toHaveBeenCalled();
    const name = screen.getByText("Corner Studio");
    expect(name.tagName).toBe("SPAN");
    expect(name).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("A-12")).toBeInTheDocument();
    expect(screen.getByText("Hand-bound notebooks.")).toBeInTheDocument();
  });

  it("falls back to the authored name for an unresolved slug in production", async () => {
    stubProduction();
    loadBrands.mockResolvedValue(new Map());

    renderWithIntl(
      await BrandLine({ slug: "ghost-brand", name: "Ghost Studio", loadBrands }),
    );

    expect(screen.getByText("Ghost Studio")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/ghost-brand/)).toBeNull();
  });

  it("renders nothing for an unresolved slug with no name in production", async () => {
    stubProduction();
    loadBrands.mockResolvedValue(new Map());

    const { container } = renderWithIntl(
      await BrandLine({ slug: "ghost-brand", loadBrands }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the notice for an unresolved slug on staging, even with a name", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    loadBrands.mockResolvedValue(new Map());

    renderWithIntl(
      await BrandLine({ slug: "ghost-brand", name: "Ghost Studio", loadBrands }),
    );

    expect(
      screen.getByText("This brand doesn't have a public page right now"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ghost Studio")).toBeNull();
    // CP2-24: the notice never prints the raw slug.
    expect(screen.queryByText(/ghost-brand/)).toBeNull();
  });
});
