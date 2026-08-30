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

const { FilterSection } = await import("../filter-section");
const { FilterCheckboxGroup } = await import("../filter-checkbox-group");
const { FilterToken } = await import("../filter-token");

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
});
