// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrandSectionNav } from "../brand-section-nav";

// Key-as-value: this spec is about the strip's chrome contract, not copy.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const sections = [
  { id: "story", label: "故事" },
  { id: "picks", label: "選物" },
  { id: "where-to-buy", label: "哪裡買" },
  { id: "faq", label: "問答" },
];

const FADE = "[mask-image:linear-gradient(to_right,#000_85%,transparent)]";

beforeEach(() => {
  // jsdom ships neither observer; the strip only needs them to exist.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrandSectionNav", () => {
  it("pins under the site nav by default", () => {
    render(<BrandSectionNav sections={sections} />);
    expect(screen.getByRole("navigation").className).toContain("sticky");
  });

  it("stays in flow when sticky is false", () => {
    render(<BrandSectionNav sections={sections} sticky={false} />);
    expect(screen.getByRole("navigation").className).not.toContain("sticky");
  });

  it("fades the right edge only while links overflow past the end", () => {
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(600);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(320);

    render(<BrandSectionNav sections={sections} />);
    const scroller = screen.getByRole("link", { name: "故事" }).parentElement;
    expect(scroller?.className).toContain(FADE);
  });

  it("drops the fade when nothing overflows", () => {
    vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(320);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(320);

    render(<BrandSectionNav sections={sections} />);
    const scroller = screen.getByRole("link", { name: "故事" }).parentElement;
    expect(scroller?.className).not.toContain(FADE);
  });
});
