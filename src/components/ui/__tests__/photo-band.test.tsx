// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PhotoBand } from "@/components/ui/photo-band";

// `next/image` becomes a plain `img`, as in `image.test.tsx`, so the class the
// band puts on its photograph lands on the DOM node verbatim.
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    preload: _preload,
    ...props
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image
  }: Record<string, unknown>) => <img alt="" {...props} />,
}));

describe("PhotoBand entrance", () => {
  it("settles the photograph on load only when `entrance` is set", () => {
    const { container } = render(
      <PhotoBand image="/images/home-hero.webp" alt="" scrim="left" entrance>
        <p>copy</p>
      </PhotoBand>,
    );

    expect(container.querySelector("img")).toHaveClass(
      "motion-safe:animate-photo-settle",
    );
  });

  it("leaves the photograph still by default", () => {
    const { container } = render(
      <PhotoBand image="/images/home-hero.webp" alt="" scrim="left">
        <p>copy</p>
      </PhotoBand>,
    );

    expect(container.querySelector("img")).not.toHaveClass(
      "motion-safe:animate-photo-settle",
    );
  });

  it("clips the stacked photograph's block so the settle cannot spill", () => {
    const { container } = render(
      <PhotoBand
        image="/images/home-hero.webp"
        alt=""
        scrim="left"
        stackBelowSm
        entrance
      >
        <p>copy</p>
      </PhotoBand>,
    );

    expect(container.querySelector("img")?.parentElement).toHaveClass(
      "overflow-hidden",
    );
  });
});
