// Same ideograph ranges as search_brand_page's `has_cjk` test.
const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export function normalizePublicSearchQuery(value: string): string | null {
  const normalized = value.trim();
  if (
    normalized.length > 100 ||
    /^[\s%_*?]+$/.test(normalized) ||
    // One Han character is a real query (茶, 陶); one Latin letter or digit is
    // not. Mirrors the 1-char floor in search_brand_page (DEV-1991).
    (normalized.length < 2 && !CJK_CHAR.test(normalized))
  ) {
    return null;
  }
  return normalized;
}
