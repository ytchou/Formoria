import { parseRecoveryRetry } from "@/lib/services/enrich-blocks/plan";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type {
  CurationJob,
  CurationJobTarget,
  CurationTargetStatus,
} from "@/lib/services/curation-jobs";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Taipei",
});

export function formatJobDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "-";
}

export function formatJobDuration(
  startedAt: string | null,
  completedAt: string | null,
): string {
  if (!startedAt) return "-";

  const endMs = completedAt ? new Date(completedAt).getTime() : Date.now();
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs) || endMs < startMs)
    return "-";

  const seconds = Math.round((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}hr ${Math.floor((seconds % 3600) / 60)}min`;
}

export function jobTriggerLabel(
  trigger: CurationJob["trigger"],
  params?: unknown,
): string {
  if (trigger === "manual_rerun" && params && typeof params === "object" && "retry" in params) {
    try {
      const retry = parseRecoveryRetry(params.retry);
      if ("version" in retry) {
        if (retry.action.kind === "phase") {
          return `Retry ${retry.action.subPhase ?? retry.action.block} (${retry.action.mode.replace(/_/g, " ")})`;
        }
        return retry.action.kind === "rerun" ? "Rerun" : "Resume";
      }
      return `Retry ${retry.subPhase ?? retry.block} (${retry.mode.replace(/_/g, " ")})`;
    } catch {
      // Historical malformed parameters retain the trigger's honest fallback.
    }
  }
  return {
    admin: "Admin",
    cron: "Scheduled",
    automatic_retry: "Auto retry",
    manual_rerun: "Manual rerun",
  }[trigger];
}

export function targetStatusLabel(status: CurationTargetStatus): string {
  return {
    pending: "Pending",
    running: "Running",
    succeeded: "Succeeded",
    skipped: "Skipped",
    failed: "Failed",
    cancelled: "Cancelled",
  }[status];
}

export function JobStatusBadge({ job }: { job: CurationJob }) {
  const t = useTranslations("admin.jobs");

  if (job.dispatch_status === "failed") {
    return <Badge variant="destructive">{t("status.dispatchFailed")}</Badge>;
  }

  if (job.status === "completed" && job.failed_count > 0) {
    return (
      <Badge className="bg-warning/10 text-warning">
        {t("status.completedWithFailures")}
      </Badge>
    );
  }

  const statusMap: Record<string, { label: string; variant: "secondary" | "verified" | "destructive" }> = {
    pending: { label: "Queued", variant: "secondary" },
    running: { label: "Running", variant: "secondary" },
    completed: { label: "Completed", variant: "verified" },
    failed: { label: "Job failed", variant: "destructive" },
    cancelled: { label: "Cancelled", variant: "secondary" },
  };
  const config = statusMap[job.status] ?? statusMap.pending;

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function TargetStatusBadge({ target }: { target: CurationJobTarget }) {
  const variant =
    target.status === "failed"
      ? "destructive"
      : target.status === "succeeded"
        ? "verified"
        : target.status === "skipped"
          ? "outline"
          : "secondary";

  return <Badge variant={variant}>{targetStatusLabel(target.status)}</Badge>;
}
