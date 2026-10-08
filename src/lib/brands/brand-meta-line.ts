export type BrandMetaLineInput = {
  categoryLabel?: string | null;
  cityLabel?: string | null;
  foundingYear?: number | null;
  formatFoundingYear: (year: number) => string;
};

/**
 * The parts of the one metadata line under a brand's h1, in reading order:
 * category · city · founded year. A part we do not know is omitted rather than
 * printed as a placeholder, so an empty result means the line is not rendered.
 */
export function buildBrandMetaLineParts({
  categoryLabel,
  cityLabel,
  foundingYear,
  formatFoundingYear,
}: BrandMetaLineInput): string[] {
  const parts: string[] = [];
  const category = categoryLabel?.trim();
  if (category) parts.push(category);
  const city = cityLabel?.trim();
  if (city) parts.push(city);
  if (foundingYear != null) parts.push(formatFoundingYear(foundingYear));
  return parts;
}
