/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import zhMessages from "../../../../messages/zh-TW.json";

vi.mock("next/link", () => ({
  default: ({
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

const routerReplace = vi.fn();
let currentSearch = "";

vi.mock("@/i18n/navigation", () => ({
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
  usePathname: () => "/discover",
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const { FilterSection } = await import("../filter-section");
const { FilterCheckboxGroup } = await import("../filter-checkbox-group");
const { FilterToken } = await import("../filter-token");
const { FilterDrawer, FilterSidebar } = await import("../filter-sidebar");

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FilterSection", () => {
  it("renders a group labelled by its heading, always open", () => {
    render(
      <FilterSection title="Test Section">
        <p>Panel content</p>
      </FilterSection>,
    );

    const group = screen.getByRole("group", { name: "Test Section" });
    expect(group).toHaveTextContent("Panel content");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("FilterCheckboxGroup", () => {
  const options = [
    { value: "ceramic", label: "Ceramic", count: 29 },
    { value: "wood", label: "Wood", count: 12 },
  ];
  const labels = {
    showMoreLabel: (count: number) => `再顯示 ${count} 項`,
    showLessLabel: "顯示較少",
  };

  function manyOptions(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      value: `opt-${i}`,
      label: `Option ${i}`,
      count: 100 - i,
    }));
  }

  function visibleCheckboxes() {
    return screen
      .getAllByRole("checkbox", { hidden: true })
      .filter((box) => box.closest("label")?.hidden !== true);
  }

  it("test_filter_checkbox_group_renders_options_with_counts", () => {
    render(
      <FilterCheckboxGroup
        options={options}
        activeValues={new Set()}
        onToggle={vi.fn()}
        {...labels}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /Ceramic/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Wood/ }),
    ).toBeInTheDocument();

    expect(screen.getByText("29")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("test_filter_checkbox_group_calls_on_toggle", () => {
    const onToggle = vi.fn();
    render(
      <FilterCheckboxGroup
        options={options}
        activeValues={new Set()}
        onToggle={onToggle}
        {...labels}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Ceramic/ }));
    expect(onToggle).toHaveBeenCalledWith("ceramic", true);
  });

  it("collapses after 10 options, keeping hidden rows in the markup", () => {
    render(
      <FilterCheckboxGroup
        options={manyOptions(12)}
        activeValues={new Set()}
        onToggle={vi.fn()}
        {...labels}
      />,
    );

    expect(visibleCheckboxes()).toHaveLength(10);
    expect(screen.getAllByRole("checkbox", { hidden: true })).toHaveLength(12);
    expect(screen.getByText("Option 11").closest("label")).not.toBeVisible();

    const toggle = screen.getByRole("button", { name: "再顯示 2 項" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const listId = toggle.getAttribute("aria-controls")!;
    expect(document.getElementById(listId)).toContainElement(
      screen.getByText("Option 11"),
    );

    fireEvent.click(toggle);

    expect(visibleCheckboxes()).toHaveLength(12);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("顯示較少");
  });

  it("never hides a checked option past the limit", () => {
    render(
      <FilterCheckboxGroup
        options={manyOptions(13)}
        activeValues={new Set(["opt-11"])}
        onToggle={vi.fn()}
        {...labels}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /Option 11/ })).toBeVisible();
    expect(visibleCheckboxes()).toHaveLength(11);
    expect(
      screen.getByRole("button", { name: "再顯示 2 項" }),
    ).toBeInTheDocument();
  });

  it("hides every count when hideCounts is set", () => {
    render(
      <FilterCheckboxGroup
        options={options}
        activeValues={new Set()}
        onToggle={vi.fn()}
        hideCounts
        {...labels}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "Ceramic" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("29")).not.toBeInTheDocument();
    expect(screen.queryByText("12")).not.toBeInTheDocument();
  });

  it("makes the whole 44px row the checkbox's label", () => {
    render(
      <FilterCheckboxGroup
        options={options}
        activeValues={new Set()}
        onToggle={vi.fn()}
        {...labels}
      />,
    );

    const row = screen.getByRole("checkbox", { name: /Ceramic/ }).closest("label");
    expect(row).toHaveClass("min-h-11", "grid");
    expect(row).not.toHaveClass("min-h-8");
    expect(row).toHaveTextContent("Ceramic");
    expect(row).toHaveTextContent("29");
  });

  it("does not collapse a single overflowing option", () => {
    render(
      <FilterCheckboxGroup
        options={manyOptions(11)}
        activeValues={new Set()}
        onToggle={vi.fn()}
        {...labels}
      />,
    );

    expect(visibleCheckboxes()).toHaveLength(11);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("FilterToken", () => {
  it("test_filter_token_renders_dismiss_link", () => {
    renderWithIntl(
      <FilterToken
        href="/brands"
        label="搜尋"
        removeLabel="移除 搜尋：zzzz"
        value="zzzz"
        variant="chip"
      />,
    );

    const link = screen.getByRole("link", { name: "移除 搜尋：zzzz" });
    expect(link).toHaveAttribute("href", "/brands");
    // The separator comes from `filters.token`: a full-width colon in zh-TW.
    expect(link).toHaveTextContent("搜尋：zzzz");
    expect(link).not.toHaveTextContent("搜尋:");
    expect(screen.getByText("搜尋")).toHaveClass("font-medium", "text-ink");
    expect(screen.getByText("zzzz")).toHaveClass("text-ink-muted");
    // X icon is present (aria-hidden svg)
    const svg = link.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("the badge renders visually hidden from AT while the caller's label names the chip", () => {
    renderWithIntl(
      <FilterToken
        href="/discover"
        label="材質"
        removeLabel="移除 材質: 金屬（自動判斷）"
        value="金屬"
        variant="chip"
        badge="自動判斷"
      />,
    );

    const link = screen.getByRole("link", { name: /自動判斷/ });
    expect(link).toHaveAttribute("aria-label", "移除 材質: 金屬（自動判斷）");
    const badge = link.querySelector('[data-slot="badge"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent("自動判斷");
    expect(badge).toHaveAttribute("aria-hidden");
  });

  it("the accessible name is exactly the caller's label, with no appended badge text", () => {
    renderWithIntl(
      <FilterToken
        href="/discover"
        label="Material"
        removeLabel="Remove Material: Metal (Auto-detected)"
        value="Metal"
        variant="chip"
        badge="Auto-detected"
      />,
    );

    expect(
      screen.getByRole("link", {
        name: "Remove Material: Metal (Auto-detected)",
      }),
    ).toBeInTheDocument();
  });

  it("test_filter_token_without_badge_renders_no_badge", () => {
    renderWithIntl(
      <FilterToken
        href="/brands"
        label="Category"
        removeLabel="Remove Category: Home"
        value="Home"
        variant="chip"
      />,
    );

    const link = screen.getByRole("link", { name: "Remove Category: Home" });
    expect(link.querySelector('[data-slot="badge"]')).toBeNull();
  });
});

describe("FilterDrawer clearAll", () => {
  const drawerProps = {
    locale: "zh-TW",
    activeCategory: "home",
    allLabel: "全部",
    totalCount: 10,
    categoryHref: (slug: string | null) => (slug ? `/brands/${slug}` : "/brands"),
    labels: {
      title: "篩選",
      category: "分類",
      subcategory: "子分類",
      material: "材質",
      showMore: (count: number) => `再顯示 ${count} 項`,
      showLess: "顯示較少",
    },
    triggerLabel: "篩選",
    showResultsLabel: "顯示結果",
    clearAllLabel: "清除全部",
  };

  function lastReplaceParams() {
    const target = routerReplace.mock.calls.at(-1)?.[0] as string;
    return new URL(target, "http://localhost").searchParams;
  }

  function renderDrawer(extra: { clearAllExtraKeys?: ["category"] } = {}) {
    render(
      <NextIntlClientProvider locale="zh-TW" messages={zhMessages}>
        <FilterDrawer {...drawerProps} {...extra} />
      </NextIntlClientProvider>,
    );
  }

  function clearAllFromOpenDrawer() {
    fireEvent.click(screen.getByRole("button", { name: /^篩選/ }));
    fireEvent.click(screen.getByRole("button", { name: "清除全部" }));
  }

  it("clear-all removes category in search mode", () => {
    routerReplace.mockClear();
    currentSearch = "search=gift&category=home&sub=cups&material=metal";
    renderDrawer({ clearAllExtraKeys: ["category"] });

    clearAllFromOpenDrawer();

    const params = lastReplaceParams();
    expect(params.has("category")).toBe(false);
    expect(params.has("sub")).toBe(false);
    expect(params.has("material")).toBe(false);
    expect(params.get("search")).toBe("gift");
  });

  it("clear-all keeps category when no extra keys are given", () => {
    routerReplace.mockClear();
    currentSearch = "category=home&sub=cups&material=metal";
    renderDrawer();

    clearAllFromOpenDrawer();

    const params = lastReplaceParams();
    expect(params.get("category")).toBe("home");
    expect(params.has("sub")).toBe(false);
    expect(params.has("material")).toBe(false);
  });
});

describe("FilterSidebar", () => {
  const sidebarProps = {
    locale: "zh-TW",
    activeCategory: null,
    allLabel: "全部",
    totalCount: 10,
    categoryCounts: { home: 41, kitchen: 17 },
    subcategoryOptions: [
      { slug: "cups", label: "杯子", count: 23, category: "kitchen" },
    ],
    categoryHref: (slug: string | null) => (slug ? `/brands/${slug}` : "/brands"),
    labels: {
      title: "篩選",
      category: "分類",
      subcategory: "子分類",
      material: "材質",
      showMore: (count: number) => `再顯示 ${count} 項`,
      showLess: "顯示較少",
    },
  };

  it("shows 全部, category and subcategory counts by default", () => {
    currentSearch = "";
    render(<FilterSidebar {...sidebarProps} />);

    expect(screen.getByRole("link", { name: "全部" })).toHaveTextContent(/\d/);
    expect(screen.getByText("23")).toBeInTheDocument();
  });

  it("hides every count when hideCounts is set", () => {
    currentSearch = "search=zzzz";
    render(<FilterSidebar {...sidebarProps} hideCounts />);

    const nav = screen.getByRole("navigation", { name: "篩選" });
    expect(screen.getByRole("link", { name: "全部" })).not.toHaveTextContent(/\d/);
    expect(screen.getByRole("checkbox", { name: "杯子" })).toBeInTheDocument();
    expect(nav).not.toHaveTextContent(/\d/);
  });

  it("makes each category link a 44px row", () => {
    currentSearch = "";
    render(<FilterSidebar {...sidebarProps} />);

    expect(screen.getByRole("link", { name: "全部" })).toHaveClass("min-h-11");
  });
});
