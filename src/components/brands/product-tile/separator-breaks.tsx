import { Fragment, type ReactNode } from "react";

const HAN = /\p{Script=Han}/u;
// Capturing, so `split` keeps each separator as its own segment.
const SEPARATORS = /([・／/×])/;

/**
 * Puts a `<wbr>` after each name separator (「・」「／」「/」「×」) in a zh
 * product name, so a card title styled `break-keep` breaks only between the
 * parts of a compound name such as 「Orii×DO / T」 (BD-13).
 *
 * Deterministic on purpose: `phraseBreaks()` segments with `Intl.Segmenter`,
 * which may differ between server and client and fail hydration, and the shelf
 * renders these tiles on the client. A name with no Han, or no separator,
 * passes through unchanged and reports `hasBreaks: false` — the caller applies
 * `break-keep` only when this returns true, because `keep-all` on an
 * unpunctuated zh name makes it one word that `overflow-wrap` splits at the
 * line edge, worse than the balanced wrap it gets today.
 */
export function separatorBreaks(name: string): {
  node: ReactNode;
  hasBreaks: boolean;
} {
  if (!HAN.test(name)) return { node: name, hasBreaks: false };
  const parts = name.split(SEPARATORS);
  // A separator with nothing after it (trailing, or doubled) needs no break.
  const breaksAfter = (i: number) =>
    SEPARATORS.test(parts[i] ?? "") && Boolean(parts[i + 1]);
  if (!parts.some((_, i) => breaksAfter(i))) {
    return { node: name, hasBreaks: false };
  }
  return {
    node: parts.map((part, i) => (
      <Fragment key={i}>
        {part}
        {breaksAfter(i) ? <wbr /> : null}
      </Fragment>
    )),
    hasBreaks: true,
  };
}
