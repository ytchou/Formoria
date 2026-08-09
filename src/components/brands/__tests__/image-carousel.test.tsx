// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BrandImageMeta } from "@/lib/types/brand";
import { ImageCarousel } from "../image-carousel";

// `next/image` is swapped for a plain `img` so `className` lands on the DOM
// node verbatim — the fill-mode carve-out is exactly what these assertions read.
vi.mock("next/image", () => ({
  default: ({
    preload: _preload,
    fill: _fill,
    ...props
  }: Record<string, unknown>) => <img {...props} />,
}));
// Translations resolve to their keys: this spec is about index alignment, not
// copy, and key-as-value keeps the expected alt strings unambiguous.
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/images/allowed-image-hosts", () => ({
  safeImageSrc: (url: string | null) => (url === "BAD" ? null : url),
}));
vi.mock("@/lib/analytics", () => ({
  trackGalleryPhotoView: vi.fn(),
  trackGalleryCompleted: vi.fn(),
}));
vi.mock("../brand-engagement-tracker", () => ({
  useBrandEngagement: () => ({ reportEngagement: vi.fn() }),
}));

// The middle URL is rejected by `safeImageSrc`, so the rendered list is one
// shorter than `imageAlts`. Every entry below therefore has a DIFFERENT value
// at its filtered position than at its original position — which is what makes
// the assertions able to fail if the component ever indexes the filtered list.
const IMAGES = ["https://good.test/first.jpg", "BAD", "https://good.test/third.jpg"];
const IMAGE_ALTS: BrandImageMeta[] = [
  { altZh: "第一張", altEn: "First logo", isLogo: true, focalX: null, focalY: null },
  { altZh: "第二張", altEn: "Second photo", isLogo: false, focalX: 0.25, focalY: 0.75 },
  { altZh: "第三張", altEn: "Third logo", isLogo: true, focalX: null, focalY: null },
];

function renderCarousel() {
  return render(
    <ImageCarousel
      images={IMAGES}
      alt="Formoria"
      brandId="brand-id"
      brandSlug="formoria"
      imageAlts={IMAGE_ALTS}
    />,
  );
}

/**
 * Query order is stable: the outgoing hero is `aria-hidden` (so `byRole` skips
 * it), leaving the current hero first and then the thumbnail grid in order.
 */
function images(): HTMLElement[] {
  return screen.getAllByRole("img");
}

describe("ImageCarousel", () => {
  it("resolves alt text from the original index, not the filtered one", () => {
    renderCarousel();
    const [hero, firstThumb, secondThumb] = images();

    expect(hero).toHaveAttribute("alt", "First logo");
    expect(firstThumb).toHaveAttribute("alt", "First logo");
    // The second surviving image came from source index 2. Indexing the
    // filtered list would hand it index 1 — "Second photo".
    expect(secondThumb).toHaveAttribute("alt", "Third logo");
  });

  it("resolves the logo fill mode from the original index, not the filtered one", () => {
    renderCarousel();
    const [hero, firstThumb, secondThumb] = images();

    expect(hero).toHaveClass("object-contain", "p-6");
    expect(firstThumb).toHaveClass("object-contain", "p-1.5");
    // Source index 2 is a logo; filtered index 1 is not, and would render
    // `object-cover` here.
    expect(secondThumb).toHaveClass("object-contain", "p-1.5");
  });

  it("keeps the mapping after advancing past the dropped image", () => {
    renderCarousel();
    fireEvent.click(screen.getByRole("button", { name: "gallery.next" }));

    const [hero] = images();
    expect(hero).toHaveAttribute("alt", "Third logo");
    expect(hero).toHaveClass("object-contain", "p-6");
  });

  it("falls back to the generated alt when no metadata is supplied", () => {
    render(
      <ImageCarousel
        images={IMAGES}
        alt="Formoria"
        brandId="brand-id"
        brandSlug="formoria"
      />,
    );

    const [hero] = images();
    expect(hero).toHaveAttribute("alt", "gallery.photoAltWithBrand");
    expect(hero).toHaveClass("object-cover");
  });

  it("applies focal positioning to normal images but not logos", () => {
    render(
      <ImageCarousel
        images={["https://good.test/logo.jpg", "https://good.test/photo.jpg"]}
        alt="Formoria"
        brandId="brand-id"
        brandSlug="formoria"
        imageAlts={[
          { altZh: null, altEn: null, isLogo: true, focalX: 0.1, focalY: 0.2 },
          { altZh: null, altEn: null, isLogo: false, focalX: 0.25, focalY: 0.75 },
        ]}
      />,
    );
    const [logoHero] = images();

    expect(logoHero).not.toHaveStyle({ objectPosition: "10% 20%" });
    fireEvent.click(screen.getByRole("button", { name: "gallery.next" }));
    const [normalHero] = images();
    expect(normalHero).toHaveStyle({ objectPosition: "25% 75%" });
  });
});
