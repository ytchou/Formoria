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
 * ANCHORED, because product photos print facts in the same characters. The
 * literal first version flagged 34 of 1,337 staging images, most of them clean:
 * 「22%維生素C」, 「85% Omega-3」, 「99%抗UV」, 「折疊拖鞋」. So:
 *   - `%` only as a discount: 「20% OFF」, or after 省/折扣/優惠/降 (「最高省30%」).
 *   - 折 only after a number (「8折」「7.9折」, not 「3折傘」) or in 折扣/折價/
 *     折抵/打折.
 *   - 省 only before money (「再省$220」「現省一百」), never 省力 or 省電.
 *   - `NT` only as NT$ / NTD / NT before a digit, never inside a word (MINT).
 *   - 元 only directly after a digit (「599元」), never 元素 or 多元.
 * 贈 and 限時 stay literal: on a product photo they are almost always a gift
 * with purchase or a time-limited offer. Ceiling: 「贈禮」 on a gift box is a
 * false positive, which costs an editor one more photo choice. Upgrade path:
 * move the judgement into the vision call that reads the text.
 *
 * Not applied to product names or descriptions, where 折疊 and 「100% 純棉」
 * are ordinary copy.
 */

const DIGIT = "[0-9０-９]";
const PERCENT = "[%％]";
/** A money amount: currency sign, NT, an Arabic digit or a Chinese numeral. */
const MONEY = `(?:\\$|＄|NT|${DIGIT}|[一二兩三四五六七八九十百千萬])`;

/** Ordered as reported. Each marker appears in the result at most once. */
const COMMERCE_MARKERS: ReadonlyArray<{ marker: string; pattern: RegExp }> = [
  { marker: "$", pattern: /\$/ },
  { marker: "＄", pattern: /＄/ },
  {
    marker: "NT",
    pattern: new RegExp(`(?<![A-Za-z])NT(?:\\$|＄|D|\\s*${DIGIT})`, "i"),
  },
  { marker: "元", pattern: new RegExp(`${DIGIT}\\s*元`) },
  {
    marker: "%",
    pattern: new RegExp(
      `${PERCENT}\\s*off(?![a-z])|(?:省|折扣|優惠|降)\\s*${DIGIT}+(?:\\.${DIGIT}+)?\\s*${PERCENT}`,
      "i",
    ),
  },
  {
    marker: "折",
    pattern: new RegExp(
      `${DIGIT}+(?:\\.${DIGIT}+)?\\s*折(?![傘疊叠])|折扣|折價|折抵|打折`,
    ),
  },
  { marker: "省", pattern: new RegExp(`省\\s*${MONEY}`) },
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
