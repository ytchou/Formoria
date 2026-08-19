// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IMAGE_SURFACE_SIZES, SurfaceImage } from "@/components/ui/image";

// `next/image` becomes a plain `img`, exactly as every other image spec in this
// repo does it, so the prop the wrapper computes lands on the DOM node verbatim.
// Rendering the real component here would test Next's optimizer, not the
// surface-to-`sizes` mapping this file is about.
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    ...props
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
  }: Record<string, unknown>) => <img alt="" {...props} />,
}));

describe("SurfaceImage", () => {
  it("emits sizes for its declared surface", () => {
    render(
      <>
        <SurfaceImage
          surface="card"
          src="/images/hero-bg.webp"
          alt=""
          fill
          data-testid="card"
        />
        <SurfaceImage
          surface="hero"
          src="/images/hero-bg.webp"
          alt=""
          fill
          data-testid="hero"
        />
      </>,
    );

    const card = screen.getByTestId("card");
    const hero = screen.getByTestId("hero");

    expect(card).toHaveAttribute("sizes", IMAGE_SURFACE_SIZES.card);
    expect(hero).toHaveAttribute("sizes", IMAGE_SURFACE_SIZES.hero);
    // The point of the surface vocabulary: these two cannot collapse into one
    // string by omission, because `surface` has no default.
    expect(card.getAttribute("sizes")).not.toBe(hero.getAttribute("sizes"));
  });

  it("lets a one-off box override the surface hint", () => {
    render(
      <SurfaceImage
        surface="thumb"
        // The admin media preview is a fixed 176px square.
        sizes="176px"
        src="/images/hero-bg.webp"
        alt=""
        fill
        data-testid="override"
      />,
    );

    expect(screen.getByTestId("override")).toHaveAttribute("sizes", "176px");
  });

  it("keeps every surface hint distinct", () => {
    const values = Object.values(IMAGE_SURFACE_SIZES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("renders the alt text it is given, including the decorative empty string", () => {
    render(
      <>
        <SurfaceImage
          surface="tile"
          src="/images/hero-bg.webp"
          alt="A woven rattan stool beside a window"
          fill
        />
        <SurfaceImage
          surface="tile"
          src="/images/hero-bg.webp"
          alt=""
          fill
          data-testid="decorative"
        />
      </>,
    );

    expect(
      screen.getByAltText("A woven rattan stool beside a window"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("decorative")).toHaveAttribute("alt", "");
  });
});
