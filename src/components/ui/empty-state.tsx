import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The shared "there is nothing here" shell: a centered icon → title → body →
 * optional action column on the page ground. No card (EL-13): a bordered
 * surface read as one more result tile, so the block is grouped by space alone
 * — `py-section`, the named rhythm between page sections (DESIGN.md §3).
 *
 * The title is a `<p>`, not a heading. Callers sit under h1s and h2s at
 * different depths, and a fixed heading level here would skip levels on some.
 *
 * Deliberately content-free — it takes an already-localized title and body and
 * a ready-made action node, so it renders identically from a server component
 * and from a client one without dragging a translator scope along.
 */
type EmptyStateProps = {
  /** Lucide icon element; rendered muted at 32px. */
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
      className={cn(
        'flex flex-col items-center py-section text-center',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-4 text-ink-muted [&_svg]:size-8"
        >
          {icon}
        </span>
      ) : null}
      <p className="type-section text-ink">{title}</p>
      {body ? <p className="mt-2 content-column type-body-sm">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
