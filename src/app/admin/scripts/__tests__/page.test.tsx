// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AdminScriptsPage from "../page";

describe("AdminScriptsPage", () => {
  it("links to the bulk community submissions utility", () => {
    render(<AdminScriptsPage />);

    expect(
      screen.getByRole("heading", { name: "Bulk community submissions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open tool" })).toHaveAttribute(
      "href",
      "/admin/scripts/bulk-community-submissions",
    );
  });
});
