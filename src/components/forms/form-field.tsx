'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { fieldTextStyles } from '@/components/ui/text-styles'
import { cn } from '@/lib/utils'

type FormFieldContextValue = { error: boolean; errorId?: string }
const FormFieldContext = createContext<FormFieldContextValue>({ error: false })
export function useFormFieldContext() {
  return useContext(FormFieldContext)
}

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
  const computedErrorId = errorId ?? (id && error ? `${id}-error` : undefined)

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
    <div className={cn('space-y-2', className)}>
      {label && id ? (
        <Label htmlFor={id}>{labelContent}</Label>
      ) : label ? (
        <p className={cn('flex items-center gap-2', fieldTextStyles.formLabel)}>
          {labelContent}
        </p>
      ) : null}
      {description ? (
        <p className={fieldTextStyles.hint}>{description}</p>
      ) : null}
      <FormFieldContext value={{ error: Boolean(error), errorId: computedErrorId }}>
        {children ? children : null}
      </FormFieldContext>
      {error ? (
        <p id={computedErrorId} className={cn(fieldTextStyles.error, 'animate-error-shake')} aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  )
}
