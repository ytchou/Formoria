/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The i18n Link needs the app router context it never gets in a unit render;
// the anchor is all this suite asserts on.
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
}));

const { SectionHeader } = await import("../section-header");

describe("SectionHeader", () => {
  it("section header renders heading, optional note and optional right-aligned link", () => {
    render(
      <SectionHeader
        id="landing-selection"
        heading="Formoria Selection"
        note="We chose these on purpose."
        linkHref="/brands"
        linkLabel="See every listed brand"
      />,
    );

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Formoria Selection",
    });
    // The section that wraps this header points its aria-labelledby here.
    expect(heading).toHaveAttribute("id", "landing-selection");

    expect(screen.getByText("We chose these on purpose.")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "See every listed brand" });
    expect(link).toHaveAttribute("href", "/brands");
    // Right alignment comes from the row pushing the link to the end, not from
    // text-align, so the heading and note stay left at the page gutter.
    expect(link.className).toContain("ml-auto");
  });

  it("omits the note and the link when they are not supplied", () => {
    const { container } = render(<SectionHeader heading="Stories" />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Stories" }),
    ).not.toHaveAttribute("id");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders the link only when both an href and a label are supplied", () => {
    const { rerender } = render(
      <SectionHeader heading="Stories" linkHref="/stories" />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(<SectionHeader heading="Stories" linkLabel="View all" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(
      <SectionHeader
        heading="Stories"
        linkHref="/stories"
        linkLabel="View all"
      />,
    );
    expect(screen.getByRole("link", { name: "View all" })).toBeInTheDocument();
  });
});
