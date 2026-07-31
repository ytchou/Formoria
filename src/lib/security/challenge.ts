import { SignJWT, jwtVerify } from 'jose'

export const CHALLENGE_COOKIE_NAME = 'fm_verified'

// 7 days. Once a human passes Turnstile, don't ask again for the whole launch
// week. Tighten toward hours if abuse shows up in the soft-limit metrics.
export const CHALLENGE_TTL_SECONDS = 604_800

function getChallengeSecret(): Uint8Array {
  const secret = process.env.CHALLENGE_SECRET
  if (!secret) {
    throw new Error('CHALLENGE_SECRET is required')
  }

  return new TextEncoder().encode(secret)
}

export async function signChallengeToken(ip: string): Promise<string> {
  return new SignJWT({ ip })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(getChallengeSecret())
}

/**
 * The `ip` claim is recorded for forensics but deliberately NOT compared. TW
 * mobile carriers run CGNAT with rotating egress IPs, so pinning the token to
 * an IP re-challenges a verified human on every tower/Wi-Fi handoff. Signature
 * + expiry is the real gate; IP binding only bought protection against token
 * sharing, which is not the threat model here.
 */
export async function verifyChallengeToken(token: string, _ip: string): Promise<boolean> {
  try {
    await jwtVerify(token, getChallengeSecret())
    return true
  } catch {
    return false
  }
}
