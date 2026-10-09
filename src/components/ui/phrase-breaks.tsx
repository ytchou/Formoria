import { Fragment, type ReactNode } from "react";

const segmenter = new Intl.Segmenter("zh-TW", { granularity: "word" });
const HAN = /\p{Script=Han}/u;

/**
 * Puts a `<wbr>` between the words of a zh heading, so a heading styled
 * `break-keep` breaks only between words. No browser segments Chinese
 * phrases in CSS (`word-break: auto-phrase` is Japanese-only in Chromium),
 * so the segmentation runs here, on the server, with the ICU dictionary.
 * A `<wbr>` goes only between two word-like segments: punctuation and spaces
 * are already break opportunities under `keep-all`, and a `<wbr>` before a
 * full-width colon or comma would let it start a line.
 * Server components only: a client render could segment differently and
 * fail hydration.
 */
export function phraseBreaks(text: string): ReactNode {
  if (!HAN.test(text)) return text;
  const segments = [...segmenter.segment(text)];
  return segments.map((segment, i) => (
    <Fragment key={i}>
      {i > 0 && segment.isWordLike && segments[i - 1]?.isWordLike ? <wbr /> : null}
      {segment.segment}
    </Fragment>
  ));
}
