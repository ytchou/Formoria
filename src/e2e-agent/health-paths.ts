// Re-exports from the shared worker-boot module. The e2e-agent's health-check
// tests and server.ts import from here, keeping the paths in sync without each
// worker maintaining its own copy.
export { isWorkerHealthPath as isE2eAgentHealthPath } from '@/worker-boot/health-paths'
