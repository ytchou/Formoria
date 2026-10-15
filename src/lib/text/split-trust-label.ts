const SEPARATORS = ["：", " — "] as const;

/**
 * Splits a trust-label message ("<term>：<description>" in zh-TW,
 * "<term> — <description>" in English) at the first separator found.
 * No separator: the whole string is the term and description is null.
 */
export function splitTrustLabel(text: string): {
  term: string;
  description: string | null;
} {
  let index = -1;
  let length = 0;
  for (const separator of SEPARATORS) {
    const found = text.indexOf(separator);
    if (found >= 0 && (index < 0 || found < index)) {
      index = found;
      length = separator.length;
    }
  }
  if (index < 0) return { term: text, description: null };
  return { term: text.slice(0, index), description: text.slice(index + length) };
}
