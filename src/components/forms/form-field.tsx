import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { fieldTextStyles } from '@/components/ui/text-styles'
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
        <Label htmlFor={id}>
          {labelContent}
        </Label>
      ) : label ? (
        <p className={cn('flex items-center gap-2', fieldTextStyles.formLabel)}>
          {labelContent}
        </p>
      ) : null}
      {description ? (
        <p className={fieldTextStyles.hint}>{description}</p>
      ) : null}
      {children ? children : null}
      {error ? (
        <p
          id={errorId}
          className={fieldTextStyles.error}
          aria-live="polite"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
