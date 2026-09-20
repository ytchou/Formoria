// Re-exports from the shared worker-boot module. The curation worker's own
// health-check tests and server.ts import from here, so the paths stay in sync
// without each worker maintaining its own copy.
export {
  WORKER_HEALTH_PATHS as CURATION_WORKER_HEALTH_PATHS,
  isWorkerHealthPath as isCurationWorkerHealthPath,
} from "@/worker-boot/health-paths";
