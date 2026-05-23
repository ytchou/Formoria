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

async function globalSetup() {
  const requiredVars = [
    'E2E_ADMIN_EMAIL',
    'E2E_ADMIN_PASSWORD',
    'E2E_USER_EMAIL',
    'E2E_USER_PASSWORD',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];
  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required e2e env vars: ${missing.join(', ')}\nAdd them to .env.local`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Derive the project ref from the Supabase URL hostname
  // e.g. https://abcdefgh.supabase.co -> "abcdefgh"
  const hostname = new URL(supabaseUrl).hostname;
  const projectRef = hostname.split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;

  const authDir = path.join(__dirname, '.auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const domain = new URL(baseURL).hostname; // 'localhost'

  for (const role of ['admin', 'user'] as const) {
    const email = role === 'admin' ? process.env.E2E_ADMIN_EMAIL! : process.env.E2E_USER_EMAIL!;
    const password =
      role === 'admin' ? process.env.E2E_ADMIN_PASSWORD! : process.env.E2E_USER_PASSWORD!;
    const storePath = path.join(authDir, `${role}.json`);

    // Sign in via Supabase JS API — no browser needed
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      throw new Error(
        `Auth failed for ${role} (${email}): ${error?.message ?? 'no session returned'}`
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

    // Build the chunked cookie entries using @supabase/ssr's base64url encoding
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
    fs.writeFileSync(storePath, JSON.stringify(storageState, null, 2));
    console.log(`[global-setup] ${role}: wrote ${cookies.length} cookie chunk(s) to ${storePath}`);
  }
}

export default globalSetup;
