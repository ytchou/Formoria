import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface BrandBreadcrumbProps {
  category: string | null
  brandName: string
}

export function BrandBreadcrumb({ category, brandName }: BrandBreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <li>
          <Link
            href="/"
            className="transition-colors hover:text-foreground"
          >
            Home
          </Link>
        </li>
        {category && (
          <>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li>
              <Link
                href={`/?category=${encodeURIComponent(category)}`}
                className="transition-colors hover:text-foreground"
              >
                {category}
              </Link>
            </li>
          </>
        )}
        <li aria-hidden="true">
          <ChevronRight className="size-3.5" />
        </li>
        <li>
          <span aria-current="page" className="font-medium text-foreground">
            {brandName}
          </span>
        </li>
      </ol>
    </nav>
  )
}
