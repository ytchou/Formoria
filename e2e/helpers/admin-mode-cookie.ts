import { signCookieValue } from '../../src/lib/security/cookie-signing';

type AdminMode = 'god' | 'viewer';

export async function getSignedAdminModeCookie(mode: AdminMode): Promise<string> {
  const secret = process.env.CHALLENGE_SECRET;
  if (!secret) {
    throw new Error('CHALLENGE_SECRET is required to sign fm_mode cookies in E2E tests');
  }

  return signCookieValue(mode, secret);
}
