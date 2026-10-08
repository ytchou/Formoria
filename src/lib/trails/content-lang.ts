/**
 * The `lang` attribute for editorial content shown on a page of another
 * locale, or `undefined` when the content is in the page's own language.
 *
 * zh-TW content is marked with the BCP 47 tag `zh-Hant-TW` so a screen reader
 * switches voice and the browser picks Traditional Chinese glyphs. Any other
 * mismatch passes the content locale through unchanged.
 *
 * Pure and dependency-free so the client `TrailTile` can import it without
 * pulling the `fs`-backed trail loader into the client bundle; the loader
 * re-exports it for server callers.
 */
export function contentLangFor(
  contentLocale: string,
  pageLocale: string,
): string | undefined {
  if (contentLocale === pageLocale) return undefined;
  if (contentLocale === "zh-TW") return "zh-Hant-TW";
  return contentLocale;
}
