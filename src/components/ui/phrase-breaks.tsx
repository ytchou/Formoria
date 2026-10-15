import type { ReactNode } from "react";

import { withBreaks } from "@/components/ui/with-breaks";
import { phraseBreakOffsets } from "@/lib/text/phrase-break-offsets";

/**
 * Puts a `<wbr>` between the words of a zh heading, so a heading styled
 * `break-keep` breaks only between words. The segmentation rule lives in
 * `phraseBreakOffsets()`.
 * Server components only: a client render could segment differently and
 * fail hydration. A client component renders server-computed offsets with
 * `withBreaks()` instead.
 */
export function phraseBreaks(text: string): ReactNode {
  return withBreaks(text, phraseBreakOffsets(text));
}
