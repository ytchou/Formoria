// Team accounts flagged with the `is_internal` person property so PostHog's
// "filter out internal and test users" setting can exclude them. Only the
// boolean reaches PostHog — the email itself never leaves the client.
const INTERNAL_USER_EMAILS = new Set([
  'patrick.ytchou@gmail.com',
  'hello.formoria@gmail.com',
])

export function isInternalUserEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return INTERNAL_USER_EMAILS.has(email.trim().toLowerCase())
}
