import { signCookieValue, verifyCookieValue } from './cookie-signing'

/**
 * Stable, signed, anonymous browser identity used as the traversal-accounting
 * key (see traversal-counters.ts). Edge-runtime only: no Node built-in is
 * imported here and every primitive comes from WebCrypto, because this module
 * is read and written inside `src/proxy.ts`.
 *
 * DISTINCT from `fm_like_visitor` on purpose. That cookie is a write-dedup
 * identity for brand likes; this one is a read-side rate-limit identity. Fusing
 * them would let a like-dedup rotation reset everybody's rate-limit history,
 * and swapping later would cost every visitor their accumulated identity. The
 * two values are additionally domain-separated below, so a value signed for one
 * purpose does not verify for the other even under the same CHALLENGE_SECRET.
 */
export const VISITOR_COOKIE_NAME = 'fm_visitor'

export const VISITOR_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 365,
  path: '/',
}

/**
 * Domain-separation label. Mirrors `brand-like-identity.ts`, which uses
 * 'brand-likes'. Changing this string invalidates every issued cookie.
 */
const DOMAIN_LABEL = 'visitor-traversal'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const encoder = new TextEncoder()

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

let cachedSecret: string | null = null

async function getVisitorSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret

  const secret = process.env.CHALLENGE_SECRET
  if (!secret) throw new Error('CHALLENGE_SECRET is required')

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(DOMAIN_LABEL))

  cachedSecret = bytesToHex(digest)
  return cachedSecret
}

export function createVisitorId(): string {
  return crypto.randomUUID()
}

export async function signVisitorId(visitorId: string): Promise<string> {
  if (!UUID_PATTERN.test(visitorId)) throw new Error('Invalid visitor ID')
  return signCookieValue(visitorId, await getVisitorSecret())
}

export async function verifyVisitorId(
  signedValue: string | null | undefined,
): Promise<string | null> {
  if (!signedValue) return null

  const visitorId = await verifyCookieValue(signedValue, await getVisitorSecret())
  return visitorId && UUID_PATTERN.test(visitorId) ? visitorId : null
}

export interface ResolvedVisitorIdentity {
  visitorId: string
  /** The value to write back to the cookie when `minted` is true. */
  signedValue: string
  minted: boolean
}

/**
 * Reads the cookie value handed in by the caller and returns a usable identity,
 * minting a fresh one when the cookie is absent, malformed, or tampered with.
 *
 * Takes the raw string rather than a request so it stays callable from the edge
 * proxy (`request.cookies.get(...)`), from route handlers, and from tests
 * without any runtime-specific import.
 */
export async function resolveVisitorIdentity(
  signedValue: string | null | undefined,
): Promise<ResolvedVisitorIdentity> {
  const existing = await verifyVisitorId(signedValue)
  if (existing && signedValue) {
    return { visitorId: existing, signedValue, minted: false }
  }

  const visitorId = createVisitorId()
  return { visitorId, signedValue: await signVisitorId(visitorId), minted: true }
}

/**
 * One-way, fixed-length key for telemetry and counter buckets. Never store or
 * emit the raw visitor id alongside behavioral data.
 */
export async function hashVisitorId(visitorId: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(visitorId)))
}
