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
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
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

  it("the badge renders visually hidden from AT while the caller's label names the chip", () => {
    render(
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
    render(
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
