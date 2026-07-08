'use client'

import type { ComponentProps } from 'react'
import { FormField } from '@/components/forms/form-field'
import { cn } from '@/lib/utils'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { useDirtyFields } from '../dirty-fields-context'

type DashboardFormFieldProps = ComponentProps<typeof FormField> & {
  fieldName?: keyof BrandEditFormValues
}

export function DashboardFormField({
  fieldName,
  className,
  ...props
}: DashboardFormFieldProps) {
  const dirtyFields = useDirtyFields()
  const isDirty = fieldName ? Boolean(dirtyFields[fieldName]) : false

  return (
    <FormField
      className={cn(
        'rounded-md transition-colors',
        isDirty && 'bg-primary/5 ring-1 ring-primary/20',
        className,
      )}
      {...props}
    />
  )
}
