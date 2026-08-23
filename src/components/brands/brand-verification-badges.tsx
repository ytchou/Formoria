import { ShieldCheck } from 'lucide-react'
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

export function MitDeclaredBadge({ label, title }: BrandVerificationBadgeProps) {
  return (
    <Badge variant="declared" title={title} aria-label={title}>
      {label}
    </Badge>
  )
}
