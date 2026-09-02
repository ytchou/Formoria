// Railway applies the project-wide `deploy.healthcheckPath` from railway.json to
// every service in the project, including this worker. That path is the Next
// app's route (`/api/health`), which a plain node:http worker has no reason to
// serve — so before this existed the worker's healthcheck could never pass and
// Railway kept the previous container forever (DEV-1548).
//
// The worker answers both: its own `/health`, and whatever railway.json probes.
// `src/curation-worker/__tests__/curation-worker-healthcheck.test.ts` asserts
// the two stay in sync, so changing railway.json without changing this list
// fails CI rather than silently pinning production to a stale build.
export const CURATION_WORKER_HEALTH_PATHS = ["/health", "/api/health"] as const;

export function isCurationWorkerHealthPath(pathname: string | undefined): boolean {
  if (!pathname) return false;
  return (CURATION_WORKER_HEALTH_PATHS as readonly string[]).includes(pathname);
}
