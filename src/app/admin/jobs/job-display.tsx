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

export function jobTriggerLabel(trigger: CurationJob["trigger"]): string {
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
  }[status];
}

export function JobStatusBadge({ job }: { job: CurationJob }) {
  if (job.status === "pending" && job.dispatch_status === "failed") {
    return <Badge variant="destructive">Dispatch failed</Badge>;
  }

  if (job.status === "completed" && job.failed_count > 0) {
    return <Badge className="bg-warning/10 text-warning">Completed with failures</Badge>;
  }

  const statusMap: Record<string, { label: string; variant: "secondary" | "verified" | "destructive" }> = {
    pending: { label: "Pending", variant: "secondary" },
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
