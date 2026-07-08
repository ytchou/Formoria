import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FormFieldProps = {
  id?: string
  label?: ReactNode
  description?: ReactNode
  error?: ReactNode
  errorId?: string
  required?: boolean
  className?: string
  children?: ReactNode
}

export function FormField({
  id,
  label,
  description,
  error,
  errorId,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const labelContent = (
    <>
      {label}
      {required ? (
        <span aria-hidden="true" className="text-destructive">
          {' '}
          *
        </span>
      ) : null}
    </>
  )

  return (
    <div className={cn('space-y-2', className)} aria-invalid={Boolean(error)}>
      {label && id ? (
        <Label htmlFor={id} className="font-semibold text-foreground">
          {labelContent}
        </Label>
      ) : label ? (
        <p className="flex items-center gap-2 text-sm leading-none font-semibold text-foreground">
          {labelContent}
        </p>
      ) : null}
      {description ? (
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      ) : null}
      {children ? children : null}
      {error ? (
        <p
          id={errorId}
          className="text-xs leading-5 text-destructive"
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
