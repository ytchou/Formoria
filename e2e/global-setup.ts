import path from 'path';
import fs from 'fs';
import { chromium, type Browser } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { cleanupTestData } from './helpers/cleanup';
import { writeAuthStorageState } from './helpers/auth-session';

async function globalSetup() {
  // Purge stale auth session files so every worker gets a fresh Supabase token
  const authDir = path.join(__dirname, '.auth');
  if (fs.existsSync(authDir)) {
    for (const file of fs.readdirSync(authDir)) {
      fs.unlinkSync(path.join(authDir, file));
    }
  }

  // Sweep orphaned test data from previous runs (runs once, globally)
  await cleanupTestData();

  const requiredVars = [
    'E2E_ADMIN_EMAIL',
    'E2E_ADMIN_PASSWORD',
    'E2E_USER_EMAIL',
    'E2E_USER_PASSWORD',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required e2e env vars: ${missing.join(', ')}\nAdd them to .env.local`);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Preflight: validate seed insert works — catches schema changes early
  const { data: probe, error: probeErr } = await supabase
    .from('brands')
    .insert({
      name: '[E2E-TEST] Preflight Probe',
      slug: `e2e-preflight-probe-${Date.now()}`,
      status: 'approved',
    })
    .select('id')
    .single();

  if (probeErr || !probe) {
    throw new Error(
      `E2E preflight failed — seed insert rejected.\n` +
        `Constraint: ${probeErr?.code} — ${probeErr?.message}\n` +
        `Details: ${probeErr?.details}\n` +
        `Hint: Check brands table schema for new CHECK constraints or NOT NULL columns.`,
    );
  }

  // Clean up probe immediately
  await supabase.from('brands').delete().eq('id', probe.id);

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

  // webServer 2xx fires before manifests are written; probe a static chunk to avoid loadManifestFromRelativePath SyntaxError
  const manifestProbeUrl = `${baseURL}/_next/static/chunks/main.js`;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(manifestProbeUrl);
      if (res.ok) break;
    } catch {
      // server not yet serving static assets
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }

  const tmpStorePath = path.join(__dirname, '.auth', 'warmup-user.json');
  await (async () => {
    let browser: Browser | undefined;
    try {
      await writeAuthStorageState('user', tmpStorePath);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ storageState: tmpStorePath });
      const page = await context.newPage();
      await page.goto(`${baseURL}/submit/form`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('input[type="url"]').first().waitFor({ state: 'visible', timeout: 120_000 });
      try {
        await page.goto(baseURL + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[global-setup] /dashboard warm-up complete');
      } catch (err) {
        console.warn('[global-setup] /dashboard warm-up failed (non-fatal):', err instanceof Error ? err.message : String(err));
      }
      try {
        await page.goto(baseURL + '/admin', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('[global-setup] /admin warm-up complete');
      } catch (err) {
        console.warn('[global-setup] /admin warm-up failed (non-fatal):', err instanceof Error ? err.message : String(err));
      }
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
