// Taiwan practice spaces CJK from Latin text, never CJK from CJK or from
// punctuation. zh templates interpolate the brand name with no space, so a
// name whose edge is Latin needs one inserted where it meets a Han character.
const LATIN_START = /^[\p{Script=Latin}\p{N}]/u;
const LATIN_END = /[\p{Script=Latin}\p{N}]$/u;
const HAN_START = /^\p{Script=Han}/u;
const HAN_END = /\p{Script=Han}$/u;

/**
 * Inserts one space between each occurrence of `name` in `text` and an
 * adjacent Han character, on the side where the name's edge character is a
 * Latin letter or digit. The name itself is never altered, punctuation
 * neighbours are left alone, and the result is idempotent.
 */
export function spaceNameBoundaries(text: string, name: string): string {
  if (name.length === 0) return text;
  const spaceBefore = LATIN_START.test(name);
  const spaceAfter = LATIN_END.test(name);
  if (!spaceBefore && !spaceAfter) return text;

  let out = "";
  let from = 0;
  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, from)) {
    const end = at + name.length;
    // Two code units on each side cover a surrogate-pair Han character.
    const before = text.slice(Math.max(0, at - 2), at);
    const after = text.slice(end, end + 2);
    out += text.slice(from, at);
    if (spaceBefore && HAN_END.test(before)) out += " ";
    out += name;
    if (spaceAfter && HAN_START.test(after)) out += " ";
    from = end;
  }
  return out + text.slice(from);
}
