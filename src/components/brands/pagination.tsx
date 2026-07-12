'use client'

import { useTranslations } from 'next-intl'
import { useFilterParams } from '@/hooks/use-filter-params'

interface PaginationProps {
  totalCount: number
  currentPage: number
  pageSize: number
}

function getPageRange(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages: (number | 'ellipsis')[] = []

  if (currentPage <= 3) {
    pages.push(1, 2, 3, 4, 'ellipsis', totalPages)
  } else if (currentPage >= totalPages - 2) {
    pages.push(1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
  } else {
    pages.push(1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages)
  }

  return pages
}

export function Pagination({
  totalCount,
  currentPage,
  pageSize,
}: PaginationProps) {
  const t = useTranslations('brands')
  const { setPage, isPending } = useFilterParams()
  const totalPages = Math.ceil(totalCount / pageSize)

  if (totalPages <= 1) return null

  const pages = getPageRange(currentPage, totalPages)

  const navButtonClass =
    'inline-flex min-h-12 items-center justify-center rounded-lg px-3 type-body-emphasis text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40'
  const pageButtonClass =
    'inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg type-body-emphasis text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40'

  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-1">
      {/* Previous */}
      {currentPage > 1 ? (
        <button
          type="button"
          onClick={() => setPage(currentPage - 1)}
          disabled={isPending}
          className={navButtonClass}
          aria-label={t('pagination.previousAria')}
        >
          {t('pagination.previous')}
        </button>
      ) : (
        <span className="inline-flex min-h-12 items-center justify-center rounded-lg px-3 type-body-emphasis text-foreground/20">
          {t('pagination.previous')}
        </span>
      )}

      {/* Page numbers */}
      {pages.map((page, i) => {
        if (page === 'ellipsis') {
          return (
            <span
              key={`ellipsis-${i}`}
              className="inline-flex min-h-12 min-w-12 items-center justify-center type-body text-foreground/40"
            >
              …
            </span>
          )
        }

        const isActive = page === currentPage

        if (isActive) {
          return (
            <span
              key={page}
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg bg-primary type-metadata text-primary-foreground"
              aria-current="page"
            >
              {page}
            </span>
          )
        }

        return (
          <button
            key={page}
            type="button"
            onClick={() => setPage(page)}
            disabled={isPending}
            className={pageButtonClass}
          >
            {page}
          </button>
        )
      })}

      {/* Next */}
      {currentPage < totalPages ? (
        <button
          type="button"
          onClick={() => setPage(currentPage + 1)}
          disabled={isPending}
          className={navButtonClass}
          aria-label={t('pagination.nextAria')}
        >
          {t('pagination.next')}
        </button>
      ) : (
        <span className="inline-flex min-h-12 items-center justify-center rounded-lg px-3 type-body-emphasis text-foreground/20">
          {t('pagination.next')}
        </span>
      )}
    </nav>
  )
}
