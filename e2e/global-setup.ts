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

  // Best-effort warm-up: trigger Next.js cold-compile for /submit so the first
  // spec doesn't pay the full cold-compile tax. webServer is guaranteed ready
  // before globalSetup runs (Playwright waits on the webServer url first).
  // Any failure is swallowed — this must NEVER break the suite.
  const baseURL = 'http://localhost:3000';
  await (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      await fetch(`${baseURL}/submit`, { signal: controller.signal });
      clearTimeout(timer);
    } catch {
      // swallow — warm-up is best-effort only
    }
  })();
}

export default globalSetup;
