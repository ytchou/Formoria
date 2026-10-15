import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The shared "there is nothing here" shell: a centered icon → title → body →
 * optional action column on the page ground. No card (EL-13): a bordered
 * surface read as one more result tile, so the block is grouped by space alone
 * — `py-section`, the named rhythm between page sections (DESIGN.md §3).
 *
 * The title is a `<p>` by default. Callers sit under h1s and h2s at different
 * depths, and a fixed heading level here would skip levels on some — so a
 * caller that knows its outline opts in with `headingLevel`, which makes the
 * title reachable by heading navigation.
 *
 * Deliberately content-free — it takes an already-localized title and body and
 * a ready-made action node, so it renders identically from a server component
 * and from a client one without dragging a translator scope along.
 */
type EmptyStateProps = {
  /** Lucide icon element; rendered muted at 32px. */
  icon?: ReactNode
  title: string
  /** Render the title as `<h2>`/`<h3>`. Omit to keep it a `<p>`. */
  headingLevel?: 2 | 3
  body?: string | null
  /** A single button or link. More than one choice belongs in the page, not here. */
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  headingLevel,
  body = null,
  action,
  className,
}: EmptyStateProps) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : 'p'
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
      <Title className="type-section text-ink">{title}</Title>
      {body ? <p className="mt-2 content-column type-body-sm">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
