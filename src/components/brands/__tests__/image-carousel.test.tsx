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
    // `alt=""` sits before the spread so the component's own alt still wins — it
    // is there to satisfy jsx-a11y statically, not to change what renders.
    // eslint-disable-next-line @next/next/no-img-element -- this IS the mock of next/image; importing next/image here would mock the module with itself
  }: Record<string, unknown>) => <img alt="" {...props} />,
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
  { altZh: "第一張", altEn: "First logo", isLogo: true },
  { altZh: "第二張", altEn: "Second photo", isLogo: false },
  { altZh: "第三張", altEn: "Third logo", isLogo: true },
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
  it("no longer boxes at 4:3", () => {
    const { container } = renderCarousel();

    // The hero frame is the first `.relative` box in the tree. Both variants
    // now read the shared `aspect-media` token (1:1), replacing the split
    // between a 4:3 detail frame and a square grid frame.
    const heroBox = container.querySelector("div.relative");

    expect(heroBox).not.toBeNull();
    expect(heroBox).toHaveClass("aspect-media");
    expect(heroBox).not.toHaveClass("aspect-square");
    // No arbitrary-value ratio survives anywhere in the rendered tree.
    expect(container.innerHTML).not.toMatch(/aspect-\[/);
  });

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
   * The two fill modes split by role inside this one component: the hero
   * contains (DEV-1407, one product shown large with nothing beside it), while
   * the thumbnail strip covers because a row of small indicative tiles reads
   * better as a uniform strip than as a row of letterboxes.
   */
  it("contains the hero but covers the thumbnails", () => {
    render(
      <ImageCarousel
        images={[`${ALLOWED_HOST}/logo.jpg`, `${ALLOWED_HOST}/photo.jpg`]}
        alt="Formoria"
        brandId="brand-id"
        brandSlug="formoria"
        imageAlts={[
          { altZh: null, altEn: null, isLogo: true },
          { altZh: null, altEn: null, isLogo: false },
        ]}
      />,
    );

    const [logoHero, logoThumb, photoThumb] = images();

    // Hero: contained whatever the image is.
    expect(logoHero).toHaveClass("object-contain");

    // Thumbnails: the logo is still contained and inset, the photo covers.
    expect(logoThumb).toHaveClass("object-contain", "p-1.5");
    expect(photoThumb).toHaveClass("object-cover");
    // Cannot fail while the line above passes — the thumbnail class is
    // `brandImageFill`'s return verbatim and its branches are disjoint. Kept as
    // a guard against a future `cn('object-contain', thumbFill)` wrapper, which
    // this line would catch and the one above would not.
    expect(photoThumb).not.toHaveClass("object-contain");

    // Advancing to the photo keeps the hero contained — the regression this
    // guards is a future "just use cover everywhere" change.
    fireEvent.click(screen.getByRole("button", { name: "gallery.next" }));
    const [photoHero] = images();
    expect(photoHero).toHaveClass("object-contain");
  });

  /*
   * 品牌提供 — the brand-supplied credit (D11).
   *
   * DERIVED, NEVER INFERRED. The only signal is `brand_images.source ===
   * 'owner'`, written by `syncOwnerUploadedImages()` when an owner uploads
   * through the dashboard wizard. It rides the index-aligned `imageAlts` array
   * for the same reason alt text and fill mode do: the credit names ONE image,
   * and reading it off the filtered position would credit the brand for a
   * photograph it never supplied.
   *
   * It is a credit line beside the asset, never a badge — a badge would put it
   * in the same visual register as 選物, which is an editorial commitment
   * Formoria makes, not a fact about where a file came from.
   */
  function renderWithSources(sources: Array<boolean | undefined>) {
    return render(
      <ImageCarousel
        images={[`${ALLOWED_HOST}/one.jpg`, `${ALLOWED_HOST}/two.jpg`]}
        alt="Formoria"
        brandId="brand-id"
        brandSlug="formoria"
        imageAlts={sources.map((isOwnerSupplied) => ({
          altZh: null,
          altEn: null,
          isLogo: false,
          isOwnerSupplied,
        }))}
      />,
    );
  }

  it("credits an owner-supplied image beside the image it credits", () => {
    const { container } = renderWithSources([true, false]);

    const credit = container.querySelector("[data-brand-supplied]");
    expect(credit).not.toBeNull();
    expect(credit?.textContent).toBe("gallery.brandSupplied");
  });

  it("shows no credit for an image the brand did not supply", () => {
    // `source` is 'scrape' | 'google_image' | 'admin' | 'legacy' here — every
    // value that is not 'owner' collapses to the same false, because the credit
    // is a statement about provenance and only one value states it.
    const { container } = renderWithSources([false, true]);

    expect(container.querySelector("[data-brand-supplied]")).toBeNull();
  });

  it("moves the credit with the image, not with the gallery", () => {
    const { container } = renderWithSources([false, true]);

    fireEvent.click(screen.getByRole("button", { name: "gallery.next" }));

    expect(container.querySelector("[data-brand-supplied]")).not.toBeNull();
  });

  it("shows no credit when no image carries provenance", () => {
    // A brand with zero owner-supplied rows is the common case today, and a
    // conditional render is correct at zero rows. There is deliberately no
    // fallback that credits the brand for a scraped image.
    const { container } = renderWithSources([undefined, undefined]);

    expect(container.querySelector("[data-brand-supplied]")).toBeNull();
  });
});
