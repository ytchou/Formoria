/**
 * Formatting-only zh-TW normalizer.
 *
 * Vocabulary substitution was removed deliberately: a blind zh-CN -> zh-TW
 * word-swap table corrupted correct zh-TW prose (it rewrote the standard
 * approval phrase, the "made in Taiwan" support phrase, and the word for a
 * floor lamp). This function now only strips markdown, strips emoji, and
 * normalizes punctuation. Banned-term handling belongs to a curated,
 * review-gated list elsewhere -- never re-add automatic rewriting here.
 */
type LocalizationOptions = {
  brandName?: string;
  /**
   * Which language the string is PROSE IN — not which scripts appear in it.
   *
   * `normalizePunctuation` full-widths any punctuation touching a Han
   * character, which is correct inside a Chinese sentence and wrong inside an
   * English one that happens to name a studio in Han. The production dry-run of
   * `backfill:tw` rewrote `T Shape Of (謝工作室) focuses` to `（謝工作室）` on
   * two brands with no banned term involved at all (DEV-1547 Class 2).
   *
   * `"en"` therefore keeps the markdown, emoji and protected-span passes and
   * drops punctuation normalization alone. It cannot be inferred from the text
   * — an English sentence naming a Chinese studio and a Chinese sentence
   * quoting an English product name look the same to a script test — so the
   * caller that knows the column's language has to say.
   */
  language?: "zh" | "en";
};

const PROTECTED_SPAN_PATTERN = /\u0000TW_PROTECTED_(\d+)\u0000/gu;
const URL_PATTERN = /https?:\/\/\S+/gu;
const QUOTED_SPAN_PATTERN = /「[^」]*」/gu;
const CJK_CHARACTER = "[一-鿿]";

/**
 * CJK Unified Ideographs, the same range the punctuation rules above use.
 *
 * Exported because callers elsewhere need the identical question ("is there Han
 * in this string?") and had each grown their own regex: `brand-facts.ts` had a
 * fourth copy whose range already disagreed with `curated-product-ingest.ts`'s
 * (that one also covers Extension A). One shared predicate, defined next to the
 * range it must agree with, rather than a fifth.
 */
const HAN_CHARACTER = new RegExp(CJK_CHARACTER, "u");

/** True when `text` contains at least one CJK Unified Ideograph. */
export function containsHan(text: string): boolean {
  return HAN_CHARACTER.test(text);
}

function protectSpans(
  text: string,
  brandName?: string,
): { text: string; spans: string[] } {
  const spans: string[] = [];

  const protect = (value: string): string => {
    const index = spans.push(value) - 1;
    return `\u0000TW_PROTECTED_${index}\u0000`;
  };

  let protectedText = text.replace(QUOTED_SPAN_PATTERN, protect);
  protectedText = protectedText.replace(URL_PATTERN, protect);

  if (brandName) {
    protectedText = protectedText.split(brandName).join(protect(brandName));
  }

  return { text: protectedText, spans };
}

function stripMarkdown(text: string, substitutions: string[]): string {
  let stripped = text;
  let changed = false;

  stripped = stripped.replace(
    /(\*\*|__)([\s\S]*?)\1/gu,
    (_match, _marker, content: string) => {
      changed = true;
      return content;
    },
  );
  if (changed) substitutions.push("markdown:bold");

  let headingChanged = false;
  stripped = stripped.replace(/^#{1,6}[ \t]+/gmu, () => {
    headingChanged = true;
    return "";
  });
  if (headingChanged) substitutions.push("markdown:heading");

  let listChanged = false;
  stripped = stripped.replace(/^[-*][ \t]+/gmu, () => {
    listChanged = true;
    return "";
  });
  if (listChanged) substitutions.push("markdown:list");

  return stripped;
}

function stripEmoji(text: string, substitutions: string[]): string {
  let changed = false;
  const stripped = text.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\u20E3]/gu,
    () => {
      changed = true;
      return "";
    },
  );

  if (changed) substitutions.push("emoji:removed");
  return stripped;
}

function normalizePunctuation(text: string, substitutions: string[]): string {
  let normalized = text;
  let changed = false;

  const replaceAdjacentToCjk = (pattern: RegExp, replacement: string): void => {
    const next = normalized.replace(pattern, replacement);
    if (next !== normalized) changed = true;
    normalized = next;
  };

  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER}),|,(?=${CJK_CHARACTER})`, "gu"),
    "，",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER}):|:(?=${CJK_CHARACTER})`, "gu"),
    "：",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER});|;(?=${CJK_CHARACTER})`, "gu"),
    "；",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})!|!(?=${CJK_CHARACTER})`, "gu"),
    "！",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})\\?|\\?(?=${CJK_CHARACTER})`, "gu"),
    "？",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})\\(|\\((?=${CJK_CHARACTER})`, "gu"),
    "（",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})\\)|\\)(?=${CJK_CHARACTER})`, "gu"),
    "）",
  );
  replaceAdjacentToCjk(
    new RegExp(
      `(?<=${CJK_CHARACTER})\\.\\.\\.|\\.\\.\\.(?=${CJK_CHARACTER})`,
      "gu",
    ),
    "⋯⋯",
  );
  replaceAdjacentToCjk(
    new RegExp(`(?<=${CJK_CHARACTER})\\.|\\.(?=${CJK_CHARACTER})`, "gu"),
    "。",
  );

  if (changed) substitutions.push("punctuation:normalized");
  return normalized;
}

function restoreSpans(text: string, spans: string[]): string {
  return text.replace(
    PROTECTED_SPAN_PATTERN,
    (_match, index: string) => spans[Number(index)] ?? "",
  );
}

export function localizeToTW(
  text: string,
  options: LocalizationOptions = {},
): { text: string; substitutions: string[] } {
  const substitutions: string[] = [];
  const protectedText = protectSpans(text, options.brandName);

  let localized = stripMarkdown(protectedText.text, substitutions);
  localized = stripEmoji(localized, substitutions);
  if (options.language !== "en") {
    localized = normalizePunctuation(localized, substitutions);
  }

  return { text: restoreSpans(localized, protectedText.spans), substitutions };
}

export function stripAiToolArtifacts(text: string): string {
  const cleanedUrls = text.replace(URL_PATTERN, (url) => {
    const hashIndex = url.indexOf("#");
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
    const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const queryIndex = withoutHash.indexOf("?");
    if (queryIndex < 0) return url;

    const base = withoutHash.slice(0, queryIndex);
    const query = withoutHash.slice(queryIndex + 1);
    const keptParams = query.split("&").filter((param) => {
      const normalized = param.toLowerCase();
      return ![
        "utm_source=chatgpt.com",
        "utm_source=openai",
        "utm_source=copilot.com",
        "referrer=grok.com",
      ].includes(normalized);
    });

    return keptParams.length > 0
      ? `${base}?${keptParams.join("&")}${hash}`
      : `${base}${hash}`;
  });

  return cleanedUrls
    .replace(/turn\d+search\d+/gu, "")
    .replace(/citeturn\d+\w*/gu, "");
}
