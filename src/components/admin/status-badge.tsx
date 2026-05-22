import { cn } from '@/lib/utils'

type Status = 'pending' | 'approved' | 'rejected' | 'hidden'

const statusConfig: Record<Status, { label: string; className: string }> = {
  pending: {
    label: '待審核',
    className: 'bg-[#F5F4F1] text-[#7C7570]',
  },
  approved: {
    label: '已核准',
    className: 'bg-[#EAF3E8] text-[#2D5A27]',
  },
  rejected: {
    label: '已拒絕',
    className: 'bg-[#FDF3EC] text-[#D94F3D]',
  },
  hidden: {
    label: '已隱藏',
    className: 'bg-[#F5F4F1] text-[#7C7570]',
  },
}

export function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className
      )}
    >
      {config.label}
    </span>
  )
}
