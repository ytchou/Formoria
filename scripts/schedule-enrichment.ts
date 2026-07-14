import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const { runScheduledCuration } = await import("@/lib/services/curation-worker");

try {
  const result = await runScheduledCuration();
  const scheduled = result.scheduledJob
    ? `queued ${result.scheduledJob.id} for ${result.scheduledJob.scheduled_for}; `
    : "";
  console.log(
    `[curation-scheduler] ${scheduled}processed ${result.processed} ${result.processed === 1 ? "job" : "jobs"}`,
  );
} catch (error) {
  console.error(
    "[curation-scheduler]",
    error instanceof Error
      ? error.message
      : JSON.stringify(error, null, 2),
  );
  process.exitCode = 1;
}
