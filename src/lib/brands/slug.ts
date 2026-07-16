export const MAX_BRAND_SLUG_LENGTH = 80

export function slugifyRomanizedName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_BRAND_SLUG_LENGTH)
    .replace(/-$/g, '')
}

export function withSlugSuffix(baseSlug: string, suffix: number): string {
  const suffixText = `-${suffix}`
  return `${baseSlug.slice(0, MAX_BRAND_SLUG_LENGTH - suffixText.length).replace(/-$/g, '')}${suffixText}`
}
