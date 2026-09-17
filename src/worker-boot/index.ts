/**
 * Generic worker boot sequence.
 *
 * Extracted from `src/curation-worker/server.ts` so that health-agent and
 * repo-worker can reuse the same env-load → target-assertion → crash-handler
 * → build-SHA logging pattern without duplicating it.
 *
 * Each worker calls `bootWorker({ agent: '<name>' })` at startup. The
 * curation worker passes its own service loader; future workers supply theirs.
 */

import { config } from "dotenv";

export type WorkerBootOptions = {
  /** Short agent name, used in log prefixes and alert copy. */
  agent: string;
  /** Called BEFORE any service import. Must throw on environment mismatch. */
  assertTarget?: () => void;
  /** Dynamic-imports the worker's service modules. Called AFTER assertTarget. */
  loadServices?: () => Promise<void>;
  /** Failure reporter for crash handlers. Defaults to a console-only stub. */
  reportFailure?: (
    context: string,
    error: unknown,
    options?: { agent?: string },
  ) => Promise<void>;
  /** Error sanitiser for crash-handler log lines. Defaults to String(). */
  sanitizeError?: (error: unknown) => string;
};

/**
 * Boot a worker process:
 * 1. Load .env.local
 * 2. Assert the database target (fail before any service import)
 * 3. Install crash handlers (unhandledRejection, uncaughtException)
 * 4. Dynamic-import the worker's service modules
 */
export async function bootWorker(options: WorkerBootOptions): Promise<void> {
  const {
    agent,
    assertTarget,
    loadServices,
    reportFailure,
    sanitizeError = String,
  } = options;

  // 1. Load environment
  config({ path: ".env.local", quiet: true });

  // 2. Assert database target before any service import
  if (assertTarget) {
    assertTarget();
  }

  // 3. Install crash handlers
  if (reportFailure) {
    process.on("unhandledRejection", (reason) => {
      console.error(
        `[${agent}:unhandled-rejection]`,
        sanitizeError(reason),
      );
      void reportFailure("unhandledRejection", reason, { agent });
    });

    process.on("uncaughtException", (error) => {
      console.error(
        `[${agent}:uncaught-exception]`,
        sanitizeError(error),
      );
      void reportFailure("uncaughtException", error, { agent });
    });
  }

  // 4. Import service modules
  if (loadServices) {
    await loadServices();
  }
}

/**
 * Log the worker's build identity on startup. Shared across all workers so
 * the startup log format stays uniform.
 */
export function logWorkerBuildInfo(agent: string): void {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.WORKER_BUILD_SHA ??
    "unknown";
  console.log(
    `[${agent}] build sha=${sha.slice(0, 12)} branch=${
      process.env.RAILWAY_GIT_BRANCH ?? "unknown"
    } deployment=${process.env.RAILWAY_DEPLOYMENT_ID ?? "unknown"} nodeEnv=${
      process.env.NODE_ENV ?? "unset"
    }`,
  );
}
