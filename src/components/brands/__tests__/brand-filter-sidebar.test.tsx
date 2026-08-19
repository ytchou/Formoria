/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh-TW.json";
import { MATERIALS } from "@/lib/taxonomy/ontology";

const { replace, push, searchParams } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  searchParams: { current: new URLSearchParams() },
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/brands",
  useRouter: () => ({ push, replace }),
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

// `SearchInput` reaches for the un-localized router through `useFilterParams`.
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
  usePathname: () => "/brands",
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/lib/analytics", () => ({
  trackCategoryFilterApplied: vi.fn(),
  trackFilterCleared: vi.fn(),
  trackPriceFilterApplied: vi.fn(),
  trackSubcategoryFilterApplied: vi.fn(),
  trackVerificationFilterApplied: vi.fn(),
}));

const { BrandFilterSidebar } = await import("../brand-filter-sidebar");

const CATEGORIES = [
  { slug: "home", name: "Home & Living", nameZh: "居家生活" },
  { slug: "fashion", name: "Fashion", nameZh: "時尚服飾" },
];

type TestLocale = "zh-TW" | "en";

const MATERIAL_COUNTS: Record<string, number> = { ceramic: 29, wood: 12 };

/**
 * The derivation `DirectoryView` runs at `directory-view.tsx`, mirrored: slug
 * into `value`, ontology label into `label`, zero counts dropped. It is
 * mirrored rather than imported because the rail's contract IS the shape it
 * receives, and the server component that builds it is async and reaches the
 * brand service, so it cannot be rendered in jsdom.
 *
 * There is no `categories.materials` namespace any more — the label comes off
 * `MATERIALS`, so the twelve slugs and their two labels have exactly one home.
 */
function materialOptions(
  locale: TestLocale,
  counts: Record<string, number> = MATERIAL_COUNTS,
) {
  return MATERIALS.map((material) => ({
    value: material.slug,
    label: locale === "zh-TW" ? material.nameZh : material.nameEn,
    count: counts[material.slug] ?? 0,
  })).filter((option) => option.count > 0);
}

function messagesFor(locale: TestLocale) {
  return locale === "zh-TW" ? zhMessages : enMessages;
}

function renderSidebar(
  props: Partial<React.ComponentProps<typeof BrandFilterSidebar>> = {},
  query = "",
  locale: TestLocale = "zh-TW",
) {
  searchParams.current = new URLSearchParams(query);
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)}>
      <BrandFilterSidebar
        categories={CATEGORIES}
        materials={materialOptions(locale)}
        totalCount={24}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

function materialSection(locale: TestLocale = "zh-TW") {
  return screen.getByRole("button", {
    name: messagesFor(locale).brands.filters.material,
  });
}

function materialPanel(locale: TestLocale = "zh-TW") {
  const id = materialSection(locale).getAttribute("aria-controls") ?? "";
  const panel = document.getElementById(id);
  if (!panel) throw new Error("material panel has no aria-controls target");
  return panel;
}

describe("BrandFilterSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("material_options_carry_the_locale_label — 陶瓷 in zh-TW, Ceramic in en, one slug behind both", () => {
    const zh = renderSidebar({}, "", "zh-TW");
    fireEvent.click(materialSection("zh-TW"));
    expect(
      within(materialPanel("zh-TW")).getByRole("checkbox", { name: /陶瓷/ }),
    ).toBeInTheDocument();
    zh.unmount();

    renderSidebar({}, "", "en");
    fireEvent.click(materialSection("en"));
    const box = within(materialPanel("en")).getByRole("checkbox", {
      name: /Ceramic/,
    });
    expect(box).toBeInTheDocument();

    // Only the label is localized. The value behind both renderings is the
    // slug, which is what the URL and `brands.material` carry.
    fireEvent.click(box);
    expect(replace).toHaveBeenCalledWith("/brands?material=ceramic", {
      scroll: false,
    });
  });

  it("material_toggle_writes_the_slug_to_the_url", () => {
    renderSidebar({ activeMaterials: [] });

    fireEvent.click(materialSection());
    fireEvent.click(
      within(materialPanel()).getByRole("checkbox", { name: /陶瓷/ }),
    );
    // Not the percent-encoded zh-TW term it used to write: `?material=` is a
    // slug list now, readable in a log line and stable across locales.
    expect(replace).toHaveBeenCalledWith("/brands?material=ceramic", {
      scroll: false,
    });
  });

  it("zero_count_materials_are_not_rendered", () => {
    // `lacquer` is in the closed vocabulary with no brands behind it. A rail
    // entry that can only ever return an empty page is worse than no entry, so
    // the derivation drops every zero-count slug before the sidebar sees it.
    renderSidebar({
      materials: materialOptions("zh-TW", { ...MATERIAL_COUNTS, lacquer: 0 }),
    });

    fireEvent.click(materialSection());
    expect(within(materialPanel()).getAllByRole("checkbox")).toHaveLength(2);
    expect(materialPanel().textContent).not.toContain("漆");
  });

  it("unknown_url_terms_are_not_resurrected", () => {
    // `parseDirectoryViewFilters` drops anything outside the closed 12-slug
    // vocabulary, so `activeMaterials` is empty here on purpose. Reading the
    // raw param back would tick nothing yet keep `xyz` in every URL the
    // sidebar writes.
    renderSidebar({ activeMaterials: [] }, "material=xyz");

    fireEvent.click(materialSection());
    for (const box of within(materialPanel()).getAllByRole("checkbox")) {
      expect(box).not.toBeChecked();
    }

    fireEvent.click(
      within(materialPanel()).getByRole("checkbox", { name: /陶瓷/ }),
    );
    expect(replace).toHaveBeenCalledWith("/brands?material=ceramic", {
      scroll: false,
    });
  });

  it("clears the material key entirely when the last slug is unticked", () => {
    // The bug this pins: with a rejected slug surviving in the set, unticking
    // rewrote `?material=xyz` instead of deleting the key, so the facet could
    // not be cleared at all and the page stayed noindex.
    renderSidebar({ activeMaterials: ["ceramic"] }, "material=ceramic");

    fireEvent.click(
      within(materialPanel()).getByRole("checkbox", { name: /陶瓷/ }),
    );
    expect(replace).toHaveBeenCalledWith("/brands", { scroll: false });
  });

  it("takes a collapsed section out of the tab order without hiding its markup", () => {
    renderSidebar();

    // Closed by default with no active material: `grid-rows-[0fr]` hides it
    // visually and nothing else, so its checkboxes stayed tabbable and in the
    // accessibility tree. `inert` closes both; the markup stays in the server
    // HTML that crawlers read (DESIGN.md §6).
    expect(materialSection()).toHaveAttribute("aria-expanded", "false");
    expect(materialPanel()).toHaveAttribute("inert");
    expect(materialPanel().textContent).toContain("陶瓷");

    fireEvent.click(materialSection());
    expect(materialSection()).toHaveAttribute("aria-expanded", "true");
    expect(materialPanel()).not.toHaveAttribute("inert");
  });

  it("names each category checkbox from its visible label alone", () => {
    renderSidebar({ activeCategorySlugs: ["home"] });

    const box = screen.getByRole("checkbox", { name: "居家生活" });
    // An aria-label would outrank the visible text and make the accessible
    // name immune to it.
    expect(box).not.toHaveAttribute("aria-label");
  });
});
