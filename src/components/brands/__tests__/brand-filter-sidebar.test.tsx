/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh-TW.json";
import { MATERIALS, VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";

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

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
  usePathname: () => "/brands",
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/lib/analytics", () => ({
  trackCategoryFilterApplied: vi.fn(),
  trackFilterCleared: vi.fn(),
  trackSubcategoryFilterApplied: vi.fn(),
}));

const { BrandFilterDrawer, BrandFilterSidebar } =
  await import("../brand-filter-sidebar");

type TestLocale = "zh-TW" | "en";

const MATERIAL_COUNTS: Record<string, number> = { ceramic: 29, wood: 12 };

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
        locale={locale}
        activeCategory={null}
        allLabel={messagesFor(locale).common.all}
        materialOptions={materialOptions(locale)}
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

  it("renders category links for all visible L1 categories", () => {
    renderSidebar();

    // "All" link
    const allLink = screen.getByRole("link", { name: "全部" });
    expect(allLink).toHaveAttribute("aria-current", "page");
    expect(allLink).toHaveAttribute("href", "/brands");

    // Each visible L1 category has a link
    for (const category of VISIBLE_L1_CATEGORIES) {
      expect(
        screen.getByRole("link", { name: category.nameZh }),
      ).toBeInTheDocument();
    }
  });

  it("marks the active category link with aria-current", () => {
    renderSidebar({ activeCategory: "fashion" });

    const fashionLink = screen.getByRole("link", {
      name: VISIBLE_L1_CATEGORIES.find((c) => c.slug === "fashion")!.nameZh,
    });
    expect(fashionLink).toHaveAttribute("aria-current", "page");

    const allLink = screen.getByRole("link", { name: "全部" });
    expect(allLink).not.toHaveAttribute("aria-current");
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
    expect(replace).toHaveBeenCalledWith("/brands?material=ceramic", {
      scroll: false,
    });
  });

  it("sidebar_renders_every_material_option_it_is_handed", () => {
    const options = MATERIALS.filter((material) =>
      ["ceramic", "wood", "lacquer"].includes(material.slug),
    ).map((material) => ({
      value: material.slug,
      label: material.nameZh,
      count: MATERIAL_COUNTS[material.slug] ?? 0,
    }));

    renderSidebar({ materialOptions: options });

    fireEvent.click(materialSection());
    const panel = materialPanel();
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(options.length);
    for (const option of options) {
      expect(
        within(panel).getByRole("checkbox", { name: new RegExp(option.label) }),
      ).toBeInTheDocument();
    }
  });

  it("unknown_url_terms_are_not_resurrected", () => {
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
    renderSidebar({ activeMaterials: ["ceramic"] }, "material=ceramic");

    fireEvent.click(
      within(materialPanel()).getByRole("checkbox", { name: /陶瓷/ }),
    );
    expect(replace).toHaveBeenCalledWith("/brands", { scroll: false });
  });

  it("takes a collapsed section out of the tab order without hiding its markup", () => {
    renderSidebar();

    expect(materialSection()).toHaveAttribute("aria-expanded", "false");
    expect(materialPanel()).toHaveAttribute("inert");
    expect(materialPanel().textContent).toContain("陶瓷");

    fireEvent.click(materialSection());
    expect(materialSection()).toHaveAttribute("aria-expanded", "true");
    expect(materialPanel()).not.toHaveAttribute("inert");
  });

  it("filter drawer renders and opens", () => {
    searchParams.current = new URLSearchParams();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BrandFilterDrawer
          locale="en"
          activeCategory={null}
          allLabel="All"
          materialOptions={materialOptions("en")}
          totalCount={24}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

    const body = document.querySelector('[data-slot="sheet-body"]');
    expect(body).not.toBeNull();
  });
});
