/**
 * WCAG COLOUR MATHS, WRITTEN ONCE.
 *
 * Two gates need the same three functions — `generate-design-tokens.mjs` prints
 * the token table's contrast column, and `check-photo-band-contrast.ts`
 * composites a photograph under a scrim — and they each grew their own copy,
 * with the two published sRGB thresholds (0.03928 and 0.04045) one on each
 * side. On 8-bit integer channels those thresholds cannot actually disagree, so
 * nothing was wrong; the problem is that a fix to one copy would not reach the
 * other, which is the same argument `check-zh-terms.ts` makes for not
 * reimplementing the banned-term matcher.
 *
 * `.mjs`, not `.ts`, for one reason: `generate-design-tokens.mjs` runs under
 * bare `node` and cannot import TypeScript. The TS gate imports this happily
 * (`allowJs`), so one module serves both runtimes.
 */

/** The WCAG sRGB transfer curve, on a 0..255 channel. */
export function srgbChannel(value) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/**
 * `#rrggbb` to channels. Returns `null` rather than throwing so a token table
 * can skip a non-hex value (`var(--x)`, `oklch(...)`) and keep going.
 */
export function hexToRgb(hex) {
  const body = hex.replace("#", "");
  if (body.length !== 6) return null;
  const channels = [0, 2, 4].map((i) =>
    Number.parseInt(body.slice(i, i + 2), 16),
  );
  if (channels.some((channel) => Number.isNaN(channel))) return null;
  return /** @type {[number, number, number]} */ (channels);
}

/** Relative luminance of an `[r, g, b]` triple, channels 0..255. */
export function relativeLuminance([r, g, b]) {
  return (
    0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
  );
}

/** Relative luminance of a hex colour, or `null` if it is not one. */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? relativeLuminance(rgb) : null;
}

/**
 * The contrast ratio between two LUMINANCES.
 *
 * The luminance overload is the primitive rather than a convenience: a
 * composited photograph pixel has a luminance and no hex, so a hex-only helper
 * is what forced the second copy of this formula in the first place.
 */
export function contrastFromLuminance(a, b) {
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

/** The contrast ratio between two hex colours, or `null` if either is not one. */
export function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  if (la == null || lb == null) return null;
  return contrastFromLuminance(la, lb);
}

/**
 * A `#rrggbb` custom property out of a stylesheet, by token name. Throws: a
 * caller asking for a specific token wants the token, and a missing one means
 * the stylesheet moved under it.
 */
export function readHexToken(css, token) {
  const match = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match || !match[1]) {
    throw new Error(`token ${token} not found in the stylesheet`);
  }
  return match[1];
}
