'use client'

import { cn } from '@/lib/utils'

type StatusPillVariant = 'verified' | 'declared' | 'unverified' | 'pending'

const variants: Record<StatusPillVariant, { dot: string; text: string }> = {
  verified: { dot: 'bg-verified-green', text: 'text-verified-green' },
  declared: { dot: 'bg-mit-verified', text: 'text-mit-verified' },
  pending: { dot: 'bg-warning', text: 'text-warning' },
  unverified: { dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
}

interface StatusPillProps {
  variant: StatusPillVariant
  label: string
  animate?: boolean
  className?: string
  children?: React.ReactNode
}

export function StatusPill({
  variant,
  label,
  animate = false,
  className,
  children,
}: StatusPillProps) {
  const v = variants[variant]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2',
        animate && 'animate-reveal-up',
        className,
      )}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full transition-colors duration-300',
          v.dot,
        )}
      />
      <span
        className={cn(
          'text-sm font-medium transition-colors duration-300',
          v.text,
        )}
      >
        {label}
      </span>
      {children}
    </span>
  )
}
