import { BadgeCheck, ShieldCheck } from 'lucide-react'

const badgeClassName =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-sans text-[11px] font-semibold'

type BrandVerificationBadgeProps = {
  label: string
  title: string
}

export function MitVerifiedBadge({ label, title }: BrandVerificationBadgeProps) {
  return (
    <span title={title} className={`${badgeClassName} bg-mit-verified-bg text-mit-verified`}>
      <ShieldCheck className="h-[11px] w-[11px]" aria-hidden />
      {label}
    </span>
  )
}

export function OwnerVerifiedBadge({ label, title }: BrandVerificationBadgeProps) {
  return (
    <span title={title} className={`${badgeClassName} bg-verified-green-bg text-verified-green`}>
      <BadgeCheck className="h-[11px] w-[11px]" aria-hidden />
      {label}
    </span>
  )
}
