// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SectionDetailLayout } from "@/components/dashboard/section-detail-layout";

describe("SectionDetailLayout", () => {
  it("names the panel with a real heading and describes it beneath", () => {
    render(
      <SectionDetailLayout description="Shown on the public page." title="Links">
        <p>panel body</p>
      </SectionDetailLayout>,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Links" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Shown on the public page.")).toBeInTheDocument();
    expect(screen.getByText("panel body")).toBeInTheDocument();
  });

  it("gives the edit control an accessible name that says which panel it edits", () => {
    // A row of four identical "Edit" links is four identical accessible names.
    // The scope belongs in the name, not in the surrounding visual context,
    // because a screen-reader user reaches the link through a list of links.
    render(
      <SectionDetailLayout
        description="Shown on the public page."
        editHref="/dashboard/brands/acme/edit?step=2"
        editLabel="Edit"
        title="Links"
      >
        <p>panel body</p>
      </SectionDetailLayout>,
    );

    const edit = screen.getByRole("link", { name: "Edit: Links" });
    expect(edit).toHaveAttribute("href", "/dashboard/brands/acme/edit?step=2");
  });

  it("renders no edit control when the panel is read-only", () => {
    render(
      <SectionDetailLayout description="Read only." title="Verification">
        <p>panel body</p>
      </SectionDetailLayout>,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
