import "@testing-library/jest-dom/vitest";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe } from "vitest";

/**
 * Every audited call awaits its own audit write, and the default write is a
 * REAL insert through `globalThis.fetch`. Any test that stubs `fetch` to fail
 * therefore also fails the audit insert, which classifies as retryable and
 * sleeps through the real in-process backoff INSIDE the test -- turning an
 * error-path assertion into a 15s timeout with no code defect.
 *
 * Installed globally rather than per file: the landmine is armed by stubbing
 * `fetch`, which is the single most common thing a unit test does.
 *
 * A per-file `setAuditWriteSeam` still wins -- this runs first, and the
 * `afterEach` reset keeps seam and loss counters from leaking across tests.
 *
 * LOAD-BEARING dynamic import: a static import here would load the emitter --
 * and its `captureAlert` dependency -- into the module cache BEFORE a test
 * file's `vi.mock` factories are registered, so the emitter would keep a
 * reference to the real module and the mock would never be observed.
 */
async function auditEmitter() {
  return import("@/lib/audit/emit");
}

beforeEach(async () => {
  const { setAuditWriteSeam } = await auditEmitter();
  setAuditWriteSeam(async () => null);
});

afterEach(async () => {
  const { resetAuditEmitterForTests } = await auditEmitter();
  resetAuditEmitterForTests();
});

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
