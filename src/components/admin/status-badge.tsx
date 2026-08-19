import { cn } from '@/lib/utils'
import type { BrandStatus, SubmissionStatus } from '@/lib/types/brand'

type StatusConfig = { label: string; className: string }

const submissionStatusConfig: Record<SubmissionStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    className: 'bg-surface text-ink-muted',
  },
  approved: {
    label: 'Approved',
    className: 'bg-verified-green-bg text-verified-green',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-danger/10 text-danger',
  },
}

const brandStatusConfig: Record<BrandStatus, StatusConfig> = {
  approved: submissionStatusConfig.approved,
  hidden: {
    label: 'Hidden',
    className: 'bg-surface text-ink-muted',
  },
}

function StatusBadgeBase({ config }: { config: StatusConfig }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 type-metadata',
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
