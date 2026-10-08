/**
 * `@supabase/ssr` stores the session as `sb-<project-ref>-auth-token`, split
 * into `.0`, `.1`, … chunks once it outgrows one cookie. The cookie is not
 * httpOnly (the SDK default), so the browser can read it.
 */
const SESSION_COOKIE_NAME = /^sb-.+-auth-token(?:\.\d+)?$/

/**
 * True when the cookie string carries a Supabase session cookie. A presence
 * check only — it says nothing about whether the session is still valid, so a
 * `true` must still be confirmed by the server.
 */
export function hasSupabaseAuthCookie(cookieString: string): boolean {
  return cookieString.split(';').some((pair) => {
    const separator = pair.indexOf('=')
    if (separator === -1) return false
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    return value !== '' && SESSION_COOKIE_NAME.test(name)
  })
}
