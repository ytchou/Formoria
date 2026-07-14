import { Badge } from "@/components/ui/badge";
import type {
  CurationJob,
  CurationJobTarget,
  CurationTargetStatus,
} from "@/lib/services/curation-jobs";

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
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
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小時 ${Math.floor((seconds % 3600) / 60)} 分`;
}

export function jobTriggerLabel(trigger: CurationJob["trigger"]): string {
  return {
    admin: "管理員",
    cron: "排程",
    automatic_retry: "自動重試",
    manual_rerun: "手動重跑",
  }[trigger];
}

export function targetStatusLabel(status: CurationTargetStatus): string {
  return {
    pending: "待處理",
    running: "執行中",
    succeeded: "成功",
    skipped: "略過",
    failed: "失敗",
  }[status];
}

export function JobStatusBadge({ job }: { job: CurationJob }) {
  if (job.status === "pending" && job.dispatch_status === "failed") {
    return <Badge variant="destructive">派送失敗</Badge>;
  }

  if (job.status === "completed" && job.failed_count > 0) {
    return <Badge className="bg-warning/10 text-warning">完成但有失敗</Badge>;
  }

  const config = {
    pending: { label: "待處理", variant: "secondary" as const },
    running: { label: "執行中", variant: "secondary" as const },
    completed: { label: "已完成", variant: "verified" as const },
    failed: { label: "工作失敗", variant: "destructive" as const },
  }[job.status];

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
