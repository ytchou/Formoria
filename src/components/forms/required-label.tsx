import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

export function RequiredLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <Label htmlFor={htmlFor}>
      {children}{' '}
      <span aria-hidden="true" className="text-destructive">
        *
      </span>
    </Label>
  )
}
