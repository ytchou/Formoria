import type { BrowserContext, StorageState } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  E2E_STAGING_SESSION_COOKIE,
  E2E_STAGING_SESSION_TTL_SECONDS,
  signStagingSession,
} from "../../src/lib/security/staging-session";

export const DEEP_STAGING_SESSION_STATE = path.join(
  __dirname,
  "../.auth/deep-staging-session.json",
);

export function isCanonicalStagingTarget(baseURL: string): boolean {
  return new URL(baseURL).origin === "https://staging.formoria.com";
}

export async function writeDeepStagingSessionState(
  baseURL: string,
  runId: string,
): Promise<void> {
  const state: StorageState = { cookies: [], origins: [] };
  if (isCanonicalStagingTarget(baseURL)) {
    state.cookies.push({
      name: E2E_STAGING_SESSION_COOKIE,
      value: await signStagingSession(runId),
      domain: "staging.formoria.com",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + E2E_STAGING_SESSION_TTL_SECONDS,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
  }

  fs.mkdirSync(path.dirname(DEEP_STAGING_SESSION_STATE), { recursive: true });
  fs.writeFileSync(DEEP_STAGING_SESSION_STATE, JSON.stringify(state, null, 2));
}

export async function addDeepStagingSessionCookie(
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  if (!baseURL || !isCanonicalStagingTarget(baseURL)) return;
  const state = JSON.parse(
    fs.readFileSync(DEEP_STAGING_SESSION_STATE, "utf8"),
  ) as StorageState;
  if (state.cookies.length > 0) await context.addCookies(state.cookies);
}
