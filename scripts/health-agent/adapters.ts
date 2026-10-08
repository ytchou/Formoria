// Slack notification rendering lives in `src/lib/adapters/slack` so that
// application code can reuse it without importing from `scripts/`. Re-exported
// here for the remaining script importer (`scripts/spend-watch/report.ts`).
export type { AgentNotification } from "@/lib/adapters/slack/notification";
