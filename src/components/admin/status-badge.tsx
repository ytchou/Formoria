import { cn } from '@/lib/utils'
import type { BrandStatus, SubmissionStatus } from '@/lib/types/brand'

type Status = BrandStatus | SubmissionStatus
type StatusConfig = { label: string; className: string }

const submissionStatusConfig: Record<SubmissionStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    className: 'bg-muted text-muted-foreground',
  },
  approved: {
    label: 'Approved',
    className: 'bg-verified-green-bg text-verified-green',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-cta/10 text-destructive',
  },
}

const brandStatusConfig: Record<BrandStatus, StatusConfig> = {
  approved: submissionStatusConfig.approved,
  hidden: {
    label: 'Hidden',
    className: 'bg-muted text-muted-foreground',
  },
  pending_enrichment: {
    label: 'Pending Enrichment',
    className: 'bg-muted text-muted-foreground',
  },
}

function StatusBadgeBase({ config }: { config: StatusConfig }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 type-field-label',
        config.className
      )}
    >
      {config.label}
    </span>
  )
}

export function BrandStatusBadge({ status }: { status: BrandStatus }) {
  return <StatusBadgeBase config={brandStatusConfig[status]} />
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  return <StatusBadgeBase config={submissionStatusConfig[status]} />
}

const statusConfig: Record<Status, StatusConfig> = {
  ...submissionStatusConfig,
  hidden: brandStatusConfig.hidden,
  pending_enrichment: brandStatusConfig.pending_enrichment,
}

export function StatusBadge({ status }: { status: Status }) {
  return <StatusBadgeBase config={statusConfig[status]} />
}
