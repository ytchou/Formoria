/**
 * Operator entry point: null the brand links the checker has proven dead, and
 * report the outcome to Slack.
 *
 * The link checker has flagged dead URLs via `link_check_results.cleanup_required`
 * since it shipped, and nothing has ever acted on them — the column
 * `auto_nulled_at` sat unwritten by any code. DEV-1433 is that gap: link
 * findings were enqueued into the health agent's repair queue, which only knows
 * how to edit files, so they burned retry budget and were never fixable.
 *
 * Scope is deliberately narrow (see AUTO_NULL_STATUS_CODES in
 * src/lib/services/link-cleanup.ts): only HTTP 404 and 410 are removed
 * automatically. A 5xx or a timeout can be transient, and a wrongly-nulled
 * purchase link costs a brand real traffic with no signal that it happened.
 * The other flagged categories stay report-only and are tracked as DEV-1438
 * (connection failures are indistinguishable from timeouts) and DEV-1439
 * (405/402 are misclassified as broken).
 *
 * Safe by default: `--apply` is required to write. Every removal is reversible
 * — `updateBrand` records the previous value in `brand_field_events`, and the
 * URL itself is retained on the `link_check_results` row.
 */

import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import type { AgentNotification } from "@/lib/adapters/slack/notification";
import {
  cleanupDeadLinks,
  type LinkCleanupResult,
} from "@/lib/services/link-cleanup";

const TAIPEI_TIME_ZONE = "Asia/Taipei";

function taipeiDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
  }).format(now);
}

/**
 * Report-only categories, and where each one is tracked. Carried in the Slack
 * message so a reader sees the whole picture: what changed, and what was left
 * alone on purpose. Without this the notification reads as "9 links removed"
 * and silently implies the queue is empty.
 */
const REPORT_ONLY_TICKETS = [
  "DEV-1438 — connection failures are stored as a bare NULL, so a dead domain cannot be told apart from a timeout",
  "DEV-1439 — 405/402 are classified broken rather than blocked, inflating the queue",
] as const;

function buildNotification(
  result: LinkCleanupResult,
  applied: boolean,
): AgentNotification {
  const summary = [
    applied
      ? `Removed ${result.applied.length} dead brand ${result.applied.length === 1 ? "link" : "links"} (HTTP 404/410 only).`
      : `Dry run: ${result.applied.length} dead ${result.applied.length === 1 ? "link" : "links"} would be removed (HTTP 404/410 only).`,
    `Scanned ${result.scanned} flagged ${result.scanned === 1 ? "row" : "rows"}; ${result.skipped.length} skipped.`,
  ];

  const workDone = result.applied.map(
    (entry) =>
      `${entry.brandName ?? entry.brandId} · ${entry.field} · HTTP ${entry.statusCode} · ${entry.url}`,
  );

  const details = [
    ...result.skipped.map(
      (entry) => `skipped ${entry.field} (${entry.reason}) · ${entry.url}`,
    ),
    ...REPORT_ONLY_TICKETS.map((ticket) => `report-only: ${ticket}`),
  ];

  return {
    agent: "Link Cleanup",
    date: taipeiDate(),
    details,
    // A skip is not a failure — an owner-authored link is protected by policy
    // and staying out of it is the correct outcome. But it is the one thing a
    // reader has to act on, so it lifts the status above plain success.
    status: result.skipped.length > 0 ? "needs_attention" : "success",
    summary,
    workDone,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const notify = argv.includes("--slack");

  const result = await cleanupDeadLinks({ dryRun: !apply });

  console.log(
    apply ? "[link-cleanup] APPLY" : "[link-cleanup] DRY RUN (pass --apply)",
  );
  console.log(`  scanned: ${result.scanned}`);
  console.log(
    `  ${apply ? "removed" : "would remove"}: ${result.applied.length}`,
  );
  for (const entry of result.applied) {
    console.log(
      `    - ${entry.brandName ?? entry.brandId} · ${entry.field} · HTTP ${entry.statusCode} · ${entry.url}`,
    );
  }
  console.log(`  skipped: ${result.skipped.length}`);
  for (const entry of result.skipped) {
    console.log(`    - ${entry.field} (${entry.reason}) · ${entry.url}`);
  }

  if (notify) {
    const sent = await postSlackAlert(buildNotification(result, apply));
    console.log(`[link-cleanup] slack: ${sent ? "sent" : "not configured"}`);
  }
}

main().catch((error: unknown) => {
  console.error("[link-cleanup] failed:", error);
  process.exitCode = 1;
});
