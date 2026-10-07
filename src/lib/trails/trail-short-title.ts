/**
 * A trail's title in chip form: the part before the first colon, full-width
 * 「：」 or ASCII ":". Trail titles are written as 「主題：說明」, and a chip
 * only has room for the 主題. A title with no colon is returned whole.
 */
export function trailShortTitle(title: string): string {
  const colon = title.search(/[：:]/);
  return (colon === -1 ? title : title.slice(0, colon)).trim();
}
