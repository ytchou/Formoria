// Re-exports from the shared worker-boot module. The repo worker's health-check
// tests and server.ts import from here, keeping the paths in sync without each
// worker maintaining its own copy.
export {
  WORKER_HEALTH_PATHS as REPO_WORKER_HEALTH_PATHS,
  isWorkerHealthPath as isRepoWorkerHealthPath,
} from "@/worker-boot/health-paths";
