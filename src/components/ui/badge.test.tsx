// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("Badge", () => {
  it("renders the verified variant with mit-verified tokens", () => {
    render(<Badge variant="verified">已認證</Badge>);
    const badge = screen.getByText("已認證");
    expect(badge.className).toContain("bg-mit-verified-bg");
    expect(badge.className).toContain("text-mit-verified");
  });

  it("renders the success variant with generic success tokens", () => {
    render(<Badge variant="success">Done</Badge>);
    const badge = screen.getByText("Done");
    expect(badge.className).toContain("bg-verified-green-bg");
    expect(badge.className).toContain("text-verified-green");
  });

  it("renders the warning variant with warning tokens", () => {
    render(<Badge variant="warning">Partial</Badge>);
    const badge = screen.getByText("Partial");
    expect(badge.className).toContain("bg-warning/10");
    expect(badge.className).toContain("text-warning");
  });

  it("keeps default variant unchanged", () => {
    render(<Badge>tag</Badge>);
    expect(screen.getByText("tag").className).toContain("bg-primary");
  });
});
