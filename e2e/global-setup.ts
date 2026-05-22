import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

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

  const authDir = path.join(__dirname, '.auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  const browser = await chromium.launch();

  for (const role of ['admin', 'user'] as const) {
    const email = role === 'admin' ? process.env.E2E_ADMIN_EMAIL! : process.env.E2E_USER_EMAIL!;
    const password = role === 'admin' ? process.env.E2E_ADMIN_PASSWORD! : process.env.E2E_USER_PASSWORD!;
    const storePath = path.join(authDir, `${role}.json`);

    const page = await browser.newPage();
    await page.goto(`${baseURL}/sign-in`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    // Wait for any navigation away from /sign-in (handles redirect to /, /dashboard, etc.)
    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 15_000 });
    await page.context().storageState({ path: storePath });
    await page.close();
  }

  await browser.close();
}

export default globalSetup;
