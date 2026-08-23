import { SurfaceImage } from "@/components/ui/image";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { cn } from "@/lib/utils";

/**
 * The opening frame of a long-form route: a 16:9 lead image above the `<h1>`,
 * exactly as a feature opens in print.
 *
 * IT IS ONE COMPONENT BECAUSE IT WAS TWO COPIES. Story detail and trail detail
 * each carried the same ~25 lines — same box, same renderer split, same
 * `priority`/`fetchPriority` — and had already drifted: the trail's placeholder
 * was `bg-surface`, which is the colour of the header band the trail hero sits
 * in, so its own empty state was invisible against its own parent. The
 * placeholder is `surface-deep` here, the token `globals.css` names as "a hole
 * in the page waiting for a photograph".
 *
 * ONE RENDERER, NOT TWO. Both routes used to fall back to a raw `<img>` for an
 * author-supplied absolute URL, on the reasoning that an editor must not have
 * to edit `next.config.ts` to publish. That reasoning was false: the CSP in
 * `next.config.ts` allows `img-src` from `'self'` and `ALLOWED_IMAGE_HOSTS`
 * only, so a hero on any other host rendered an EMPTY 16:9 box — no error, no
 * fallback, and the same URL was still handed to `buildArticleJsonLd`, telling
 * Google the article's image was one the page itself could not load. An editor
 * has to add the host to `ALLOWED_IMAGE_HOSTS` either way; that list drives both
 * the CSP and `remotePatterns`, so once a host is on it `next/image` can serve
 * it and the raw `<img>` buys nothing.
 *
 * So the split is now "can this be displayed at all", and an image that cannot
 * takes the IMAGELESS path — the same degradation `trail-tile.tsx` uses
 * for a 404 or a disallowed host. Rendering nothing is the honest outcome; a
 * blank bordered box is not.
 */
export function editorialHeroSrc(
  heroImage: string | null | undefined,
): string | null {
  if (!heroImage) return null;

  /*
   * `safeImageSrc` owns the same-origin case itself (DEV-1551): a hero
   * committed at `/images/stories/x.webp` comes back unchanged, a
   * protocol-relative `//host/x.png` comes back null. The caller-side
   * leading-slash branch that used to live here got the second case wrong.
   */
  return safeImageSrc(heroImage);
}

export type EditorialHeroProps = {
  /**
   * The frontmatter value AS AUTHORED, not a pre-resolved URL. The component
   * owns the "can this be displayed" question so that a caller cannot render a
   * box around an image the page will refuse to load. Callers that also publish
   * the image (structured data, social cards) ask `editorialHeroSrc` for the
   * same answer rather than re-deriving it.
   */
  src: string | null | undefined;
  /**
   * Empty for decorative. Both routes pass `heroImageAlt ?? ""`: the `<h1>`
   * directly below already says what the image is, and a screen reader
   * repeating the title as image text is noise, not description.
   */
  alt: string;
  /** Spacing the surrounding page owns — the trail's `mb-10`, for instance. */
  className?: string;
};

export function EditorialHero({ src, alt, className }: EditorialHeroProps) {
  const imageSrc = editorialHeroSrc(src);

  if (!imageSrc) return null;

  return (
    <div
      className={cn(
        "relative aspect-[16/9] w-full overflow-hidden rounded-surface border border-rule bg-surface-deep",
        className,
      )}
    >
      {/*
        `priority` and `fetchPriority="high"`, never lazy: this is the route's
        LCP element, so deferring it defers the metric itself.
      */}
      <SurfaceImage
        src={imageSrc}
        alt={alt}
        fill
        priority
        fetchPriority="high"
        surface="banner"
        className="object-cover"
      />
    </div>
  );
}
