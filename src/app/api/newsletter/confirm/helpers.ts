export function extractToken(url: URL): string | null {
  return url.searchParams.get('token')
}

export function buildConfirmRedirectUrl(origin: string): string {
  return `${origin}/?subscribed=true`
}
