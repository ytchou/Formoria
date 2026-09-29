export function normalizePublicSearchQuery(value: string): string | null {
  const normalized = value.trim();
  if (
    normalized.length < 2 ||
    normalized.length > 100 ||
    /^[\s%_*?]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}
