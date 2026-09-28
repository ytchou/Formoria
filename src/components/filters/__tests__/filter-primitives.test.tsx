/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  usePathname: () => "/discover",
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

// The Sheet portal is out of scope here; expose the clear-all callback directly.
vi.mock("../filter-drawer-shell", () => ({
  FilterDrawerShell: ({
    clearAllLabel,
    onClearAll,
    children,
  }: {
    clearAllLabel: string;
    onClearAll: () => void;
    children: ReactNode;
  }) => (
    <div>
      <button type="button" onClick={onClearAll}>
        {clearAllLabel}
      </button>
      {children}
    </div>
  ),
}));

const { FilterSection } = await import("../filter-section");
const { FilterCheckboxGroup } = await import("../filter-checkbox-group");
const { FilterToken } = await import("../filter-token");
const { FilterDrawer } = await import("../filter-sidebar");

describe("FilterSection", () => {
  it("test_filter_section_renders_collapsed_by_default", () => {
    render(
      <FilterSection title="Test Section">
        <p>Panel content</p>
      </FilterSection>,
    );

    const toggle = screen.getByRole("button", { name: /Test Section/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const panelId = toggle.getAttribute("aria-controls")!;
    const panel = document.getElementById(panelId)!;
    expect(panel).toHaveAttribute("inert");
  });

  it("test_filter_section_toggles_open", () => {
    render(
      <FilterSection title="Toggle Me">
        <p>Content</p>
      </FilterSection>,
    );

    const toggle = screen.getByRole("button", { name: /Toggle Me/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const panelId = toggle.getAttribute("aria-controls")!;
    const panel = document.getElementById(panelId)!;
    expect(panel).toHaveAttribute("inert");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("inert");
  });
});

describe("FilterCheckboxGroup", () => {
  const options = [
    { value: "ceramic", label: "Ceramic", count: 29 },
    { value: "wood", label: "Wood", count: 12 },
  ];

  it("test_filter_checkbox_group_renders_options_with_counts", () => {
    render(
      <FilterCheckboxGroup
        options={options}
        activeValues={new Set()}
        onToggle={vi.fn()}
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
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Ceramic/ }));
    expect(onToggle).toHaveBeenCalledWith("ceramic", true);
  });
});

describe("FilterToken", () => {
  it("test_filter_token_renders_dismiss_link", () => {
    render(
      <FilterToken
        href="/brands"
        label="Category"
        removeLabel="Remove Category: Home"
        value="Home"
        variant="chip"
      />,
    );

    const link = screen.getByRole("link", { name: "Remove Category: Home" });
    expect(link).toHaveAttribute("href", "/brands");
    expect(link).toHaveTextContent("Category:");
    expect(link).toHaveTextContent("Home");
    // X icon is present (aria-hidden svg)
    const svg = link.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("test_filter_token_renders_badge_and_includes_it_in_accessible_name", () => {
    render(
      <FilterToken
        href="/discover"
        label="材質"
        removeLabel="移除 材質: 金屬"
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

  it("test_filter_token_without_badge_renders_no_badge", () => {
    render(
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
    labels: { title: "篩選", subcategory: "子分類", material: "材質" },
    triggerLabel: "篩選",
    showResultsLabel: "顯示結果",
    clearAllLabel: "清除全部",
  };

  function lastReplaceParams() {
    const target = routerReplace.mock.calls.at(-1)?.[0] as string;
    return new URL(target, "http://localhost").searchParams;
  }

  it("test_filter_drawer_clear_all_deletes_extra_keys", () => {
    routerReplace.mockClear();
    currentSearch = "search=gift&category=home&sub=cups&material=metal";
    render(<FilterDrawer {...drawerProps} clearAllExtraKeys={["category"]} />);

    fireEvent.click(screen.getByRole("button", { name: "清除全部" }));

    const params = lastReplaceParams();
    expect(params.has("category")).toBe(false);
    expect(params.has("sub")).toBe(false);
    expect(params.has("material")).toBe(false);
    expect(params.get("search")).toBe("gift");
  });

  it("test_filter_drawer_clear_all_without_extra_keys_keeps_category", () => {
    routerReplace.mockClear();
    currentSearch = "category=home&sub=cups&material=metal";
    render(<FilterDrawer {...drawerProps} />);

    fireEvent.click(screen.getByRole("button", { name: "清除全部" }));

    const params = lastReplaceParams();
    expect(params.get("category")).toBe("home");
    expect(params.has("sub")).toBe(false);
    expect(params.has("material")).toBe(false);
  });
});
