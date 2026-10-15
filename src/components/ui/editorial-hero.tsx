import { safeImageSrc } from "@/lib/images/allowed-image-hosts";

/**
 * Whether a long-form route's hero can be displayed at all, and the URL to
 * display. `EditorialHeader` renders the answer; structured data and social
 * cards publish the same answer, so the page never advertises an image it
 * cannot load.
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
