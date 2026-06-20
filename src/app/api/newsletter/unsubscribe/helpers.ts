export function extractToken(url: URL): string | null {
  return url.searchParams.get('token')
}
