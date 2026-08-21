import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";

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
