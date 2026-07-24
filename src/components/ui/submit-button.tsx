'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SubmitButtonProps {
  isSubmitting: boolean
  idleLabel: string
  submittingLabel: string
  disabled?: boolean
  variant?: 'primary'
  tone?: 'cta' | 'default'
  className?: string
}

export function SubmitButton({
  isSubmitting,
  idleLabel,
  submittingLabel,
  disabled,
  variant = 'primary',
  tone = 'cta',
  className,
}: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      variant={variant}
      tone={tone}
      disabled={disabled}
      className={cn('relative w-full', className)}
    >
      <span
        className={cn(
          'inline-flex items-center gap-2 transition-opacity duration-200',
          isSubmitting ? 'opacity-0' : 'opacity-100',
        )}
      >
        {idleLabel}
      </span>

      {isSubmitting && (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoadingDots label={submittingLabel} />
        </span>
      )}
    </Button>
  )
}

function LoadingDots({ label }: { label: string }) {
  return (
    <span className="inline-flex gap-1" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-current animate-pulse"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  )
}
