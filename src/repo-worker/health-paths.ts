// Re-exports from the shared worker-boot module. The repo worker's health-check
// tests and server.ts import from here, keeping the paths in sync without each
// worker maintaining its own copy.
export {
  isWorkerHealthPath as isRepoWorkerHealthPath,
} from "@/worker-boot/health-paths";
