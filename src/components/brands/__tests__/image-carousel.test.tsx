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
vi.mock("@/lib/analytics", () => ({
  trackGalleryPhotoView: vi.fn(),
  trackGalleryCompleted: vi.fn(),
}));
vi.mock("../brand-engagement-tracker", () => ({
  useBrandEngagement: () => ({ reportEngagement: vi.fn() }),
}));

/*
 * REAL urls against the REAL host allowlist, deliberately not a stub.
 *
 * `safeImageSrc` is the very thing whose drop these assertions are about, so
 * mocking it would leave the spec unable to notice a change in host filtering —
 * it would only ever test the stub. `ALLOWED_IMAGE_HOSTS` is `*.supabase.co`,
 * so a supabase URL survives and any other host is rejected for real.
 *
 * The middle URL is the one that gets dropped, so the rendered list is one
 * shorter than `imageAlts`. Every entry below therefore has a DIFFERENT value
 * at its filtered position than at its original position — which is what makes
 * the assertions able to fail if the component ever indexes the filtered list.
 */
const ALLOWED_HOST = "https://xkcayngbttpxyibgzern.supabase.co";
const IMAGES = [
  `${ALLOWED_HOST}/first.jpg`,
  "https://evil.example.com/dropped.jpg",
  `${ALLOWED_HOST}/third.jpg`,
];
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
    // Contained, not covered, even though this is a photo rather than a logo:
    // the carousel hero shows one product large with nothing beside it, so a
    // crop would remove product to solve a raggedness problem that only exists
    // in a grid (DEV-1407). No `p-6` — that inset is logo-only.
    expect(hero).toHaveClass("object-contain");
    expect(hero).not.toHaveClass("p-6");
  });

  /*
   * Focal positioning belongs to whatever COVERS, and in this component that is
   * the thumbnail strip, not the hero. The hero contains (DEV-1407), and a
   * contained image has no crop window to anchor — `object-position` would only
   * slide it around inside its own letterbox.
   */
  it("applies focal positioning to covering thumbnails but never to the contained hero", () => {
    render(
      <ImageCarousel
        images={[`${ALLOWED_HOST}/logo.jpg`, `${ALLOWED_HOST}/photo.jpg`]}
        alt="Formoria"
        brandId="brand-id"
        brandSlug="formoria"
        imageAlts={[
          { altZh: null, altEn: null, isLogo: true, focalX: 0.1, focalY: 0.2 },
          { altZh: null, altEn: null, isLogo: false, focalX: 0.25, focalY: 0.75 },
        ]}
      />,
    );

    const [logoHero, logoThumb, photoThumb] = images();

    // Hero: contained, so no anchoring regardless of what was measured.
    expect(logoHero).toHaveClass("object-contain");
    expect(logoHero).not.toHaveStyle({ objectPosition: "10% 20%" });

    // Thumbnails: the logo is still contained and unanchored, the photo covers
    // and carries its measured point.
    expect(logoThumb).toHaveClass("object-contain", "p-1.5");
    expect(logoThumb).not.toHaveStyle({ objectPosition: "10% 20%" });
    expect(photoThumb).toHaveClass("object-cover");
    expect(photoThumb).toHaveStyle({ objectPosition: "25% 75%" });

    // Advancing to the photo keeps the hero contained and unanchored — the
    // regression this guards is a future "just use cover everywhere" change.
    fireEvent.click(screen.getByRole("button", { name: "gallery.next" }));
    const [photoHero] = images();
    expect(photoHero).toHaveClass("object-contain");
    expect(photoHero).not.toHaveStyle({ objectPosition: "25% 75%" });
  });
});
