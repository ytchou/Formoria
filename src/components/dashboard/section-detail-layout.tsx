import { Link } from '@/i18n/navigation'
import { SurfaceCard } from '@/components/ui/card'

type SectionDetailLayoutProps = {
  title: string
  description: string
  editHref?: string
  editLabel?: string
  children: React.ReactNode
}

export function SectionDetailLayout({
  title,
  description,
  editHref,
  editLabel,
  children,
}: SectionDetailLayoutProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="type-section-title">{title}</h2>
          <p className="type-section-description">{description}</p>
        </div>
        {editHref && editLabel ? (
          <Link
            aria-label={`${editLabel}: ${title}`}
            className="type-link"
            href={editHref}
          >
            {editLabel}
          </Link>
        ) : null}
      </div>
      <SurfaceCard>{children}</SurfaceCard>
    </section>
  )
}
