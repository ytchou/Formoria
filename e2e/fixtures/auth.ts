/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { writeAuthStorageState } from '../helpers/auth-session';

const AUTH_DIR = path.join(__dirname, '../.auth');
const SESSION_BUFFER_S = 300;

function isSessionExpired(filePath: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const expires = data?.cookies?.[0]?.expires;
    if (typeof expires !== 'number') return true;
    return Math.floor(Date.now() / 1000) > expires - SESSION_BUFFER_S;
  } catch {
    return true;
  }
}

function ensureFreshSession(storePath: string): boolean {
  if (!fs.existsSync(storePath)) return false;
  if (isSessionExpired(storePath)) {
    fs.unlinkSync(storePath);
    return false;
  }
  return true;
}

type AuthFixtures = {
  adminPage: Page;
  userPage: Page;
  anonPage: Page;
};

type WorkerAuthFixtures = {
  adminStorageState: string;
  userStorageState: string;
};

export const test = base.extend<AuthFixtures, WorkerAuthFixtures>({
  // Worker-scoped: one session per worker, created lazily on first use.
  // Multiple workers signing in as the same account is intentional —
  // Supabase issues a distinct refresh token per signInWithPassword call.
  adminStorageState: [
    async ({ }, use, workerInfo) => {
      const storePath = path.join(AUTH_DIR, `admin-${workerInfo.workerIndex}.json`);
      if (!ensureFreshSession(storePath)) {
        await writeAuthStorageState('admin', storePath);
      }
      await use(storePath);
    },
    { scope: 'worker' },
  ],

  userStorageState: [
    async ({ }, use, workerInfo) => {
      const storePath = path.join(AUTH_DIR, `user-${workerInfo.workerIndex}.json`);
      if (!ensureFreshSession(storePath)) {
        await writeAuthStorageState('user', storePath);
      }
      await use(storePath);
    },
    { scope: 'worker' },
  ],

  adminPage: async ({ browser, adminStorageState }, use) => {
    const context = await browser.newContext({
      storageState: adminStorageState,
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  userPage: async ({ browser, userStorageState }, use) => {
    const context = await browser.newContext({
      storageState: userStorageState,
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  anonPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
