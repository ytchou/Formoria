/**
 * Leaf module: commerce-truth markers in free text (DEV-1962).
 *
 * Formoria never stores commerce truth — price, discount, promotion. A product
 * photo that reads 「滿額最高再省$220」「$589」「原價$676」 stores all three in
 * pixels. This module only RECOGNISES the markers in an image's transcribed
 * text; the ingest gate (`curated-product-image.ts`) and the flag script decide
 * what to do about them. A rejected image is never stored, so the product has
 * no renderable image and the public reads keep it off every surface,
 * including the home wall.
 *
 * DELIBERATELY LITERAL. 折, 省 and 贈 match wherever they appear, with no
 * attempt to tell 「8折」 from 「折疊」, 「再省$220」 from 「省力」, or 「加贈」 from
 * 「贈禮」. The ceiling is false positives on innocent words: a flagged image
 * costs an editor one more photo choice. Not applied to product names or
 * descriptions for that reason (折疊 and 「100% 純棉」 are ordinary copy). Upgrade
 * path if the false-positive rate bites: anchor 折/省 to an adjacent digit or
 * currency marker, or move the judgement into the vision call that reads the
 * text.
 *
 * Two markers are anchored because a literal match would be wrong far more
 * often than right: `NT` only as NT$ / NTD / NT before a digit, and never
 * inside a word (MINT, PRINT); 元 only directly after a digit (「599元」),
 * because 元 alone is in 元素 and 多元.
 */

const DIGIT = "[0-9０-９]";

/** Ordered as reported. Each marker appears in the result at most once. */
const COMMERCE_MARKERS: ReadonlyArray<{ marker: string; pattern: RegExp }> = [
  { marker: "$", pattern: /\$/ },
  { marker: "＄", pattern: /＄/ },
  {
    marker: "NT",
    pattern: new RegExp(`(?<![A-Za-z])NT(?:\\$|＄|D|\\s*${DIGIT})`, "i"),
  },
  { marker: "元", pattern: new RegExp(`${DIGIT}\\s*元`) },
  { marker: "%", pattern: /%/ },
  { marker: "％", pattern: /％/ },
  { marker: "折", pattern: /折/ },
  { marker: "省", pattern: /省/ },
  { marker: "贈", pattern: /贈/ },
  { marker: "限時", pattern: /限時/ },
];

/**
 * PURE. Returns the commerce-truth markers present in `text`, in marker order,
 * or an empty array when the text is clean.
 */
export function findCommerceTruthText(text: string): string[] {
  if (!text) return [];
  return COMMERCE_MARKERS.filter(({ pattern }) => pattern.test(text)).map(
    ({ marker }) => marker,
  );
}
