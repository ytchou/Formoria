import type { FormHTMLAttributes, ReactNode } from 'react'
import { surfaceCardStyles } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type StandardFormProps = FormHTMLAttributes<HTMLFormElement> & {
  children: ReactNode
}

const panelClassName = surfaceCardStyles({
  className: 'p-8',
  padding: 'none',
})

export function StandardForm({
  className,
  children,
  ...props
}: StandardFormProps) {
  return (
    <form className={cn(panelClassName, className)} {...props}>
      {children}
    </form>
  )
}

