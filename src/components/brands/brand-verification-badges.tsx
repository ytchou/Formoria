import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

type BrandVerificationBadgeProps = {
  label: string
  title: string
}

export function MitVerifiedBadge({ label, title }: BrandVerificationBadgeProps) {
  return (
    <Badge variant="verified" title={title} aria-label={title}>
      <ShieldCheck className="h-[11px] w-[11px]" aria-hidden />
      {label}
    </Badge>
  )
}

export function OwnerVerifiedBadge({ label, title }: BrandVerificationBadgeProps) {
  return (
    // ui-exception: owner-verified uses green tokens distinct from MIT-verified amber; no dedicated variant
    <Badge variant="verified" className="bg-verified-green-bg text-verified-green" title={title} aria-label={title}>
      <BadgeCheck className="h-[11px] w-[11px]" aria-hidden />
      {label}
    </Badge>
  )
}
