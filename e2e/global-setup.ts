import path from 'path';
import fs from 'fs';
import { chromium, type Browser } from '@playwright/test';
import { cleanupTestData } from './helpers/cleanup';
import { writeAuthStorageState } from './helpers/auth-session';

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

  // Browser warm-up: /submit/form is auth-gated (unauthenticated renders SubmitOverview,
  // not SubmitWizard). A plain fetch() only compiles the server bundle — it does NOT
  // trigger the client JS bundle that contains the wizard's URL input. We must use a
  // real headless browser with an authenticated storageState to force Next.js to
  // compile the full client bundle once before specs run.
  // Any failure is swallowed — this must NEVER break the suite.
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const tmpStorePath = path.join(__dirname, '.auth', 'warmup-user.json');
  await (async () => {
    let browser: Browser | undefined;
    try {
      await writeAuthStorageState('user', tmpStorePath);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ storageState: tmpStorePath });
      const page = await context.newPage();
      await page.goto(`${baseURL}/submit/form`, { waitUntil: 'domcontentloaded' });
      await page.locator('input[type="url"]').first().waitFor({ state: 'visible', timeout: 120_000 });
      await context.close();
      console.log('[global-setup] /submit/form warm-up complete — client bundle compiled');
    } catch (err) {
      console.warn('[global-setup] /submit/form warm-up failed (non-fatal):', err instanceof Error ? err.message : String(err));
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (fs.existsSync(tmpStorePath)) fs.unlinkSync(tmpStorePath);
    }
  })();
}

export default globalSetup;
