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

/**
 * What one vision read reports about an image (DEV-1989): its transcribed
 * text plus two ad-creative judgements made in the SAME call — see
 * `readImageSignals` in `@/lib/services/image-text`.
 */
export type ImageTextSignals = {
  text: string;
  /**
   * 0..1: the fraction of the image covered by overlaid or graphic text,
   * excluding text physically printed on the product or its packaging.
   */
  textCoverage: number;
  /** A person or model is the subject, presenting or endorsing the product. */
  endorsementPerson: boolean;
};

/**
 * Leaf rule: advertising creatives in product photos (DEV-1989).
 *
 * DEV-1962's markers only see commerce truth (price, discount, gift). The
 * staging review found ad creatives that carry none of it: a spokesperson ad
 * for a face mask, a mug photo overlaid with 「客製圖案 一件可印」, and a tile
 * whose banner reads 「可收納吸管的雙層吸管杯」. A Formoria photo shows the
 * product; an ad shows a campaign. Three signals:
 *
 *   - `endorsement`: the vision read says a person is the SUBJECT, presenting
 *     the product. A hand holding it, or a product-only shot, is not. NOT
 *     sufficient on its own: on the 2026-10-09 staging run it fired on 233 of
 *     1,337 images, 216 with no other signal, nearly all of them ordinary on-model photos (a swimsuit
 *     or a backpack worn by a model). It counts only when the same frame also
 *     carries campaign copy — another ad signal below or a commerce marker —
 *     which is what separates the spokesperson ad (「超導晶凍面膜 Plus」 +
 *     代言) from a lookbook photo.
 *   - `text-coverage`: overlaid or graphic text covers more than 15% of the
 *     image. Packaging text is excluded by the vision instructions, so a
 *     label-heavy box is not penalised. Ceiling: the coverage is a model
 *     estimate at `detail: low`, so a banner near the threshold can fall
 *     either side; the 15% bar sits well under the review's banner tile and
 *     well over a product-only shot.
 *   - ad-copy markers in the text, ANCHORED for the same reason as the
 *     commerce markers — product photos print ordinary words:
 *       - 一件可印 (also 1件可印, 一件就/即可印): print-on-demand ad copy. Never
 *         a product fact.
 *       - 客製 only as ad copy: 客製圖案/客製化/客製服務/客製設計/客製刻字,
 *         可客製, 接受/歡迎/提供客製. A bare 「客製」 passes. Ceiling: a product
 *         whose own packaging reads 客製化 is flagged; on a photo that is
 *         rare, and costs an editor one more photo choice.
 *       - 代言 literal (代言人, 明星代言): packaging does not name a
 *         spokesperson, ad creatives do. Ceiling: a brand that prints its
 *         spokesperson on the box is flagged.
 *       - 推薦 only as endorsement copy: after 真心/強力/大力/誠心/代言人/
 *         醫師/營養師/專家/網紅/名人/明星/店長/編輯, or before 款/好物/商品/
 *         首選/必買. Never bare, so 「推薦用法」 or 「推薦用量」 on a label
 *         pass. Ceiling: endorsement copy phrased any other way
 *         (「大家都說讚」) is missed, and then only the coverage or person
 *         signal catches it.
 *
 * Upgrade path: if the ceilings bite, move the ad-copy judgement into the
 * vision call as one more boolean, and keep these markers as an audit trail.
 */
const TEXT_COVERAGE_THRESHOLD = 0.15;

/** Ordered as reported. Each marker appears in the result at most once. */
const AD_COPY_MARKERS: ReadonlyArray<{ marker: string; pattern: RegExp }> = [
  { marker: "一件可印", pattern: /[一1１]\s*件\s*(?:就|即)?\s*可印/ },
  {
    marker: "客製",
    pattern:
      /客製(?:圖案|化|服務|設計|刻字)|(?:可|接受|歡迎|提供)\s*客製/,
  },
  { marker: "代言", pattern: /代言/ },
  {
    marker: "推薦",
    pattern:
      /(?:真心|強力|大力|誠心|代言人|醫師|營養師|專家|網紅|名人|明星|店長|編輯)\s*推薦|推薦\s*(?:款|好物|商品|首選|必買)/,
  },
];

/**
 * PURE. Returns the ad-creative reasons for one image — `endorsement`, then
 * `text-coverage`, then the ad-copy markers in marker order — or an empty
 * array when the image reads as a product photo.
 */
export function findAdCreativeSignals({
  text,
  textCoverage,
  endorsementPerson,
}: ImageTextSignals): string[] {
  const copy: string[] = [];
  if (textCoverage > TEXT_COVERAGE_THRESHOLD) copy.push("text-coverage");
  if (text) {
    for (const { marker, pattern } of AD_COPY_MARKERS) {
      if (pattern.test(text)) copy.push(marker);
    }
  }
  // A person alone is a model wearing the product; with campaign copy it is
  // an endorsement ad.
  const campaign = copy.length > 0 || findCommerceTruthText(text).length > 0;
  return endorsementPerson && campaign ? ["endorsement", ...copy] : copy;
}

/**
 * PURE. The one verdict both the ingest gate and the flag script apply, so
 * they cannot disagree about what a rejected image is. Either list being
 * non-empty rejects the image; they are kept apart so the gate can say which.
 */
export function findImageRejectionReasons(signals: ImageTextSignals): {
  commerce: string[];
  adCreative: string[];
} {
  return {
    commerce: findCommerceTruthText(signals.text),
    adCreative: findAdCreativeSignals(signals),
  };
}
