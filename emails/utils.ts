export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function listUnsubscribeHeaders(token: string): Record<string, string> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://formoria.com'
  return {
    'List-Unsubscribe': `<${siteUrl}/api/unsubscribe?token=${token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
