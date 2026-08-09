export type ReviewBadgeVariant =
  | "success"
  | "destructive"
  | "warning"
  | "secondary";

const STATUS_VARIANTS: Record<ReviewBadgeVariant, string[]> = {
  success: [
    "approved",
    "applied",
    "resolved",
    "verified",
    "complete",
    "completed",
    "succeeded",
    "actioned",
  ],
  destructive: [
    "rejected",
    "failed",
    "denied",
    "error",
    "blocked",
    "invalid",
    "duplicate",
  ],
  warning: [
    "partial",
    "incomplete",
    "stale",
    "needs_data",
    "needs_review",
    "flagged",
    "expiring",
  ],
  secondary: [
    "pending",
    "open",
    "queued",
    "running",
    "enriching",
    "skipped",
    "dismissed",
    "superseded",
    "cancelled",
    "expired",
    "unknown",
  ],
};

export function reviewStatusVariant(
  status: string | null | undefined,
): ReviewBadgeVariant {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return "secondary";

  for (const variant of ["success", "destructive", "warning", "secondary"] as const) {
    if (STATUS_VARIANTS[variant].includes(normalized)) return variant;
  }

  return "secondary";
}
