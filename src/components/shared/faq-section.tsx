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
      <div className="mb-4 border-b border-border pb-3">
        <h2 className="type-section-title">{title}</h2>
      </div>
      {children}
    </section>
  )
}
