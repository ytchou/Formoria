import type { ReactNode } from "react";

/**
 * Renders `text` with a `<wbr>` at each offset — the client-safe half of the
 * zh phrase breaks. It does no segmentation, so server and client render the
 * same markup; the offsets come from `phraseBreakOffsets()` on the server.
 * Offsets outside the text are ignored. No usable offset returns the plain
 * string.
 */
export function withBreaks(
  text: string,
  offsets: readonly number[] | undefined,
): ReactNode {
  const cuts = [...new Set(offsets ?? [])]
    .filter((offset) => offset > 0 && offset < text.length)
    .sort((a, b) => a - b);
  if (cuts.length === 0) return text;

  const parts: ReactNode[] = [];
  let start = 0;
  cuts.forEach((cut, i) => {
    parts.push(text.slice(start, cut), <wbr key={i} />);
    start = cut;
  });
  parts.push(text.slice(start));
  return parts;
}
