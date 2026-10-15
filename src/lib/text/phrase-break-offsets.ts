const HAN = /\p{Script=Han}/u;
const SEPARATOR = /[・／/×]/;

// Built on first use, so a module that only imports this file pays nothing.
let segmenter: Intl.Segmenter | undefined;

/**
 * The string indices where a zh text may break when it is styled `break-keep`:
 * the positions a `<wbr>` goes. The ONE segmentation of zh phrases — headings
 * render it through `phraseBreaks()`, and the service layer ships it with each
 * product name (`nameZhBreaks`, BD-13) so client-rendered cards draw the same
 * breaks without segmenting in the browser.
 *
 * Two rules, unioned:
 * - between two word-like segments of the ICU dictionary segmentation. No
 *   browser segments Chinese phrases in CSS (`word-break: auto-phrase` is
 *   Japanese-only in Chromium). Punctuation and spaces are already break
 *   opportunities under `keep-all`, and a break before a full-width colon or
 *   comma would let it start a line, so neither side may be punctuation.
 * - right after a name separator (「・」「／」「/」「×」) with text after it,
 *   so a compound name such as 「Orii×DO / T」 breaks between its parts. A
 *   trailing or doubled separator needs no break of its own.
 *
 * Text with no Han character returns [] — Latin text breaks at its spaces.
 *
 * Server only: `Intl.Segmenter` output depends on the runtime's ICU data, so a
 * client render could segment differently and fail hydration. Ship the
 * offsets; render them with `withBreaks()`.
 */
export function phraseBreakOffsets(text: string): number[] {
  if (!HAN.test(text)) return [];
  segmenter ??= new Intl.Segmenter("zh-TW", { granularity: "word" });

  const offsets = new Set<number>();
  let previousWordLike = false;
  for (const { index, isWordLike } of segmenter.segment(text)) {
    if (index > 0 && isWordLike && previousWordLike) offsets.add(index);
    previousWordLike = Boolean(isWordLike);
  }
  for (let i = 0; i < text.length - 1; i += 1) {
    if (SEPARATOR.test(text[i]!) && !SEPARATOR.test(text[i + 1]!)) {
      offsets.add(i + 1);
    }
  }
  return [...offsets].sort((a, b) => a - b);
}
