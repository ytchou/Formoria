/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  writeAuthStorageState,
  writeAuthStorageStateForCredentials,
} from "../helpers/auth-session";

const AUTH_DIR = path.join(__dirname, "../.auth");
const SESSION_BUFFER_S = 300;

function isSessionExpired(filePath: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const expires = data?.cookies?.[0]?.expires;
    if (typeof expires !== "number") return true;
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
  isolatedUserPage: Page;
  anonPage: Page;
};

async function applyOriginGuard(
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  const originSecret = process.env.E2E_ORIGIN_SECRET;
  const accessClientId = process.env.CF_ACCESS_CLIENT_ID;
  const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!originSecret && !accessClientId && !accessClientSecret) return;
  if (!baseURL) return;
  if (Boolean(accessClientId) !== Boolean(accessClientSecret)) {
    throw new Error(
      "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set together",
    );
  }

  const appOrigin = new URL(baseURL).origin;
  await context.route(`${appOrigin}/**`, async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        ...(originSecret ? { "x-formoria-edge": originSecret } : {}),
        ...(accessClientId && accessClientSecret
          ? {
              "CF-Access-Client-Id": accessClientId,
              "CF-Access-Client-Secret": accessClientSecret,
            }
          : {}),
      },
    });
  });
}

type WorkerAuthFixtures = {
  adminStorageState: string;
  userStorageState: string;
  isolatedUserStorageState: string;
  isolatedUser: {
    id: string;
    email: string;
    password: string;
  };
};

export const test = base.extend<AuthFixtures, WorkerAuthFixtures>({
  isolatedUser: [
    async ({}, use, workerInfo) => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
      const suffix = `${Date.now()}-${workerInfo.workerIndex}`;
      const email = `e2e-isolated-owner-${suffix}@test.local`;
      const password = `IsolatedOwner${suffix}A!`;
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(
          `Failed to create isolated E2E owner: ${error?.message ?? "missing user"}`,
        );
      }

      try {
        await use({ id: data.user.id, email, password });
      } finally {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(
          data.user.id,
        );
        if (deleteError) {
          throw new Error(
            `[e2e-cleanup] isolated owner deletion failed: ${deleteError.message}`,
          );
        }
      }
    },
    { scope: "worker" },
  ],

  // Worker-scoped: one session per worker, created lazily on first use.
  // Multiple workers signing in as the same account is intentional —
  // Supabase issues a distinct refresh token per signInWithPassword call.
  adminStorageState: [
    async ({}, use, workerInfo) => {
      const storePath = path.join(
        AUTH_DIR,
        `admin-${workerInfo.workerIndex}.json`,
      );
      if (!ensureFreshSession(storePath)) {
        await writeAuthStorageState("admin", storePath);
      }
      await use(storePath);
    },
    { scope: "worker" },
  ],

  userStorageState: [
    async ({}, use, workerInfo) => {
      const storePath = path.join(
        AUTH_DIR,
        `user-${workerInfo.workerIndex}.json`,
      );
      if (!ensureFreshSession(storePath)) {
        await writeAuthStorageState("user", storePath);
      }
      await use(storePath);
    },
    { scope: "worker" },
  ],

  isolatedUserStorageState: [
    async ({ isolatedUser }, use, workerInfo) => {
      const storePath = path.join(
        AUTH_DIR,
        `isolated-user-${workerInfo.workerIndex}.json`,
      );
      await writeAuthStorageStateForCredentials(
        isolatedUser.email,
        isolatedUser.password,
        storePath,
        "isolated user",
      );

      try {
        await use(storePath);
      } finally {
        if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
      }
    },
    { scope: "worker" },
  ],

  adminPage: async ({ browser, adminStorageState, baseURL }, use) => {
    const context = await browser.newContext({
      storageState: adminStorageState,
    });
    await applyOriginGuard(context, baseURL);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  userPage: async ({ browser, userStorageState, baseURL }, use) => {
    const context = await browser.newContext({
      storageState: userStorageState,
    });
    await applyOriginGuard(context, baseURL);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  isolatedUserPage: async (
    { browser, isolatedUserStorageState, baseURL },
    use,
  ) => {
    const context = await browser.newContext({
      storageState: isolatedUserStorageState,
    });
    await applyOriginGuard(context, baseURL);
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },

  anonPage: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext();
    await applyOriginGuard(context, baseURL);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
