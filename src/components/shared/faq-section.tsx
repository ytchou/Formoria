import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type FaqSectionProps = {
  children: ReactNode
  id?: string
  title: ReactNode
  className?: string
}

export function FaqSection({ children, className, id, title }: FaqSectionProps) {
  return (
    <section id={id} className={cn('scroll-mt-24', className)}>
      <div className="mb-4 flex items-center gap-3 border-b border-border pb-3">
        <span aria-hidden="true" className="h-8 w-1 shrink-0 bg-primary" />
        <h2 className="type-section-title-large">{title}</h2>
      </div>
      {children}
    </section>
  )
}
