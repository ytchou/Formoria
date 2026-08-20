import type { ReactNode } from 'react'
import { surfaceCardStyles } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * The shared "there is nothing here" shell: a bordered surface with a centered
 * icon → title → body → optional action column.
 *
 * Deliberately content-free — it takes an already-localized title and body and
 * a ready-made action node, so it renders identically from a server component
 * and from a client one without dragging a translator scope along.
 */
type EmptyStateProps = {
  /** Lucide icon element; rendered muted at 24px. */
  icon?: ReactNode
  title: string
  body?: string | null
  /** A single button or link. More than one choice belongs in the page, not here. */
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  body = null,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={surfaceCardStyles({
        padding: 'none',
        className: cn(
          'flex flex-col items-center px-6 py-12 text-center',
          className,
        ),
      })}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-4 text-muted-foreground [&_svg]:size-6"
        >
          {icon}
        </span>
      ) : null}
      <p className="type-card-title text-ink-muted">{title}</p>
      {body ? <p className="mt-2 max-w-md type-body-sm">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
