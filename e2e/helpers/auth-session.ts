import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';

const BASE64_PREFIX = 'base64-';
const MAX_CHUNK_SIZE = 3180;

function stringToBase64URL(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Split a value into URL-safe chunks of MAX_CHUNK_SIZE encoded bytes.
 * Mirrors @supabase/ssr's createChunks logic.
 */
function createChunks(key: string, value: string): Array<{ name: string; value: string }> {
  const encoded = `${BASE64_PREFIX}${stringToBase64URL(value)}`;
  let remaining = encodeURIComponent(encoded);
  if (remaining.length <= MAX_CHUNK_SIZE) {
    return [{ name: key, value: encoded }];
  }
  const rawChunks: string[] = [];
  while (remaining.length > 0) {
    let head = remaining.slice(0, MAX_CHUNK_SIZE);
    const lastEscape = head.lastIndexOf('%');
    if (lastEscape > MAX_CHUNK_SIZE - 3) {
      head = head.slice(0, lastEscape);
    }
    let decoded = '';
    while (head.length > 0) {
      try {
        decoded = decodeURIComponent(head);
        break;
      } catch {
        head = head.slice(0, head.length - 3);
      }
    }
    rawChunks.push(decoded);
    remaining = remaining.slice(encodeURIComponent(decoded).length);
  }
  return rawChunks.map((v, i) => ({ name: `${key}.${i}`, value: v }));
}

/**
 * Sign in as the given role and write a valid Playwright storageState JSON to
 * `outputPath`. Uses the same env-var credentials as global-setup.
 *
 * Multiple parallel workers can call this for the SAME role — Supabase will
 * issue distinct concurrent sessions (distinct refresh tokens) so workers
 * never share a refresh token.
 */
export async function writeAuthStorageStateForCredentials(
  email: string,
  password: string,
  outputPath: string,
  label = 'user',
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const hostname = new URL(supabaseUrl).hostname;
  const projectRef = hostname.split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const domain = new URL(baseURL).hostname;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    throw new Error(
      `Auth failed for ${label} (${email}): ${error?.message ?? 'no session returned'}`
    );
  }

  const session = data.session;
  const sessionJson = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user,
  });

  const chunks = createChunks(storageKey, sessionJson);
  const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + 3600;

  const cookies = chunks.map(({ name, value }) => ({
    name,
    value,
    domain,
    path: '/',
    expires: expiresAt,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }));

  const storageState = { cookies, origins: [] };

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(storageState, null, 2));
  console.log(`[auth-session] ${label}: wrote ${cookies.length} cookie chunk(s) to ${outputPath}`);
}

export async function writeAuthStorageState(
  role: 'admin' | 'user',
  outputPath: string,
): Promise<void> {
  const email = role === 'admin' ? process.env.E2E_ADMIN_EMAIL! : process.env.E2E_USER_EMAIL!;
  const password =
    role === 'admin' ? process.env.E2E_ADMIN_PASSWORD! : process.env.E2E_USER_PASSWORD!;

  await writeAuthStorageStateForCredentials(email, password, outputPath, role);
}
