import { cleanupTestData } from './helpers/cleanup';

async function globalSetup() {
  // Sweep orphaned test data from previous runs (runs once, globally)
  await cleanupTestData();

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

  // Sessions are written lazily per worker in fixtures/auth.ts.
  // global-setup intentionally does NOT write shared .auth/*.json files —
  // each Playwright worker will call writeAuthStorageState() for its own
  // per-worker path, giving every worker a distinct Supabase refresh token.
}

export default globalSetup;
