import type { AppLocale } from "@/i18n/locale-preference";

export type LedeSplit = {
  /** The first sentence, set as the hero lede, or null when there is none. */
  lede: string | null;
  /** What the story section renders: the remainder, or the full text. */
  rest: string;
};

/** Full-width terminators are unambiguous, so they count in every locale. */
const CJK_TERMINATORS = new Set(["。", "！", "？"]);
const LATIN_TERMINATORS = new Set([".", "!", "?"]);
/** Closing quotes and brackets that belong to the sentence they end. */
const CLOSERS = new Set(["」", "』", "）", ")", '"', "'", "”", "’"]);
/** A "." after one of these ends an abbreviation or an initial, not a sentence. */
const ABBREVIATION_BEFORE_DOT = /(?:^|[\s(（])(?:Mr|Mrs|Ms|Dr|St|Co|Inc|Ltd|No|vs|etc|e\.g|i\.e|[A-Z])$/;

/**
 * Budget in Latin-width units: a CJK character counts as two. zh caps at about
 * 80 CJK characters (DEV-1982); EN at about 220 Latin characters, roughly three
 * lines in the 5/12 hero column — at 160, 27% of EN pages lost their lede
 * (DEV-1993, BD2-15).
 */
const MAX_LEDE_WIDTH = { en: 220, zh: 160 } as const;
const WIDE_CHAR = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE_CHAR.test(char) ? 2 : 1;
  return width;
}

/** Index just past the first sentence end, or -1 when there is no clean one. */
function firstSentenceEnd(text: string, locale: AppLocale): number {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    // A line break before any terminator means the first block is not a
    // sentence (a heading, a list) — no clean boundary.
    if (char === "\n") return -1;

    const isCjk = CJK_TERMINATORS.has(char);
    const isLatin = locale === "en" && LATIN_TERMINATORS.has(char);
    if (!isCjk && !isLatin) continue;

    let end = i + 1;
    while (end < text.length && CLOSERS.has(text[end])) end++;

    if (isLatin) {
      // "1.5", "Mr.Casa", "golday.jewelry": a Latin terminator ends a sentence
      // only when whitespace follows it.
      if (end >= text.length || !/\s/.test(text[end])) continue;
      if (char === "." && ABBREVIATION_BEFORE_DOT.test(text.slice(0, i))) continue;
    }
    return end;
  }
  return -1;
}

export type SplitLedeOptions = {
  /**
   * Used as the lede when the description yields none. The story then keeps
   * the full description, so nothing is dropped.
   */
  fallbackLede?: string | null;
};

/**
 * Splits a brand description into its first sentence (the hero lede) and the
 * rest (the story). Renders no lede — the full text stays in the story — when
 * there is no clean boundary, when the description is a single sentence, or
 * when the first sentence is too long to read as a lede. In those cases a
 * non-empty `fallbackLede` becomes the lede instead.
 */
export function splitLede(
  description: string,
  locale: AppLocale,
  options?: SplitLedeOptions,
): LedeSplit {
  const text = description.trim();
  const fallback = options?.fallbackLede?.trim() || null;
  const noLede: LedeSplit = { lede: fallback, rest: text };
  const end = firstSentenceEnd(text, locale);
  if (end === -1) return noLede;

  const lede = text.slice(0, end).trim();
  const rest = text.slice(end).trim();
  const maxWidth = locale === "en" ? MAX_LEDE_WIDTH.en : MAX_LEDE_WIDTH.zh;
  if (!rest || displayWidth(lede) > maxWidth) return noLede;
  return { lede, rest };
}
