// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandMark } from "./BrandMark";

describe("BrandMark", () => {
  it("renders an svg with a path", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.querySelector("path")).toBeInTheDocument();
  });

  it("applies the color prop to the mark", () => {
    const { container } = render(<BrandMark color="#2F5D50" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("fill") ?? svg?.getAttribute("color")).toBe("#2F5D50");
  });

  it("accepts a size", () => {
    const { container } = render(<BrandMark size={64} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("64");
  });
});
