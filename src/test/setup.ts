import "@testing-library/jest-dom/vitest";
import { createClient } from "@supabase/supabase-js";
import { describe } from "vitest";

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost"]);
const PRODUCTION_DATABASE_HOSTS = new Set(["xkcayngbttpxyibgzern.supabase.co"]);

export function isSafeTestDatabaseUrl(
  value: string | undefined,
  remoteTestProjectRef = process.env.SUPABASE_TEST_PROJECT_REF,
) {
  if (!value) return false;

  try {
    const { hostname } = new URL(value);
    if (LOCAL_DATABASE_HOSTS.has(hostname)) return true;
    if (PRODUCTION_DATABASE_HOSTS.has(hostname)) return false;
    return Boolean(
      remoteTestProjectRef &&
      hostname === `${remoteTestProjectRef}.supabase.co`,
    );
  } catch {
    return false;
  }
}

function assertSafeTestDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for integration tests",
    );
  }
  if (!isSafeTestDatabaseUrl(url)) {
    throw new Error(
      "Refusing to run integration tests against a non-test Supabase project. Use local Supabase or set SUPABASE_TEST_PROJECT_REF to the dedicated remote test project.",
    );
  }
}

/**
 * Creates a Supabase client using the service role key for integration tests.
 * Bypasses RLS so tests can read/write all tables.
 */
export function createTestClient() {
  assertSafeTestDatabase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return createClient(url!, key!);
}

/**
 * Wrapper that skips test suites requiring a live Supabase connection
 * when environment variables are not configured.
 *
 * Usage: import { describeWithDb } from '@/test/setup'
 * then use describeWithDb('suite name', () => { ... })
 */
const runIntegrationTests =
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "true";

if (runIntegrationTests) assertSafeTestDatabase();

export const describeWithDb = runIntegrationTests ? describe : describe.skip;
