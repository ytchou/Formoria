/**
 * Shared health-check path matching for all workers.
 *
 * Railway applies the project-wide `deploy.healthcheckPath` from railway.json
 * to every service, including plain node:http workers. Each worker must answer
 * both its own `/health` and whatever railway.json probes (currently
 * `/api/health`).
 *
 * The curation worker's `health-paths.ts` re-exports from here so existing
 * imports are unchanged.
 */

export const WORKER_HEALTH_PATHS = ["/health", "/api/health"] as const;

export function isWorkerHealthPath(
  pathname: string | undefined,
): boolean {
  if (!pathname) return false;
  return (WORKER_HEALTH_PATHS as readonly string[]).includes(pathname);
}
