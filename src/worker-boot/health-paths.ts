/**
 * Shared health-check path matching for all workers.
 *
 * Each HTTP worker answers both its own `/health` and `/api/health`, the path
 * the web services' Railway healthcheck probes. railway.json no longer sets a
 * healthcheck (DEV-1920): Railway applied it to every Config-as-Code service,
 * including the one-shot curation worker, which serves no HTTP. The web
 * healthcheck now lives in each service's Railway settings.
 *
 * Only repo-worker serves HTTP today (`src/repo-worker/health-paths.ts`
 * re-exports from here). The curation worker is a cron one-shot and serves no
 * HTTP.
 */

const WORKER_HEALTH_PATHS = ["/health", "/api/health"] as const;

export function isWorkerHealthPath(
  pathname: string | undefined,
): boolean {
  if (!pathname) return false;
  return (WORKER_HEALTH_PATHS as readonly string[]).includes(pathname);
}
