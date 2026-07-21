'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname, useSearchParams } from 'next/navigation'
import { trackDirectoryPageNavigated } from '@/lib/analytics'

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

function buildPageUrl(pathname: string, searchParams: URLSearchParams, page: number): string {
  const params = new URLSearchParams(searchParams.toString())
  if (page > 1) {
    params.set('page', String(page))
  } else {
    params.delete('page')
  }
  const str = params.toString()
  return str ? `${pathname}?${str}` : pathname
}

const navLinkClass =
  'inline-flex min-h-12 items-center justify-center rounded-lg px-3 type-body-emphasis text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
const pageLinkClass =
  'inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg type-body-emphasis text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

function getPageDirection(
  targetPage: number,
  currentPage: number,
): 'prev' | 'next' | 'jump' {
  if (targetPage < currentPage) return 'prev'
  if (targetPage === currentPage + 1) return 'next'
  return 'jump'
}

export function Pagination({
  totalCount,
  currentPage,
  pageSize,
}: PaginationProps) {
  const t = useTranslations('brands')
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const totalPages = Math.ceil(totalCount / pageSize)

  if (totalPages <= 1) return null

  const pages = getPageRange(currentPage, totalPages)

  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-1">
      {/* Previous */}
      {currentPage > 1 ? (
        <Link
          href={buildPageUrl(pathname, searchParams, currentPage - 1)}
          className={navLinkClass}
          aria-label={t('pagination.previousAria')}
          scroll={false}
          onClick={() =>
            trackDirectoryPageNavigated(currentPage - 1, 'prev', totalPages)
          }
          data-ph-no-autocapture
        >
          {t('pagination.previous')}
        </Link>
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
          <Link
            key={page}
            href={buildPageUrl(pathname, searchParams, page)}
            className={pageLinkClass}
            scroll={false}
            onClick={() =>
              trackDirectoryPageNavigated(
                page,
                getPageDirection(page, currentPage),
                totalPages,
              )
            }
            data-ph-no-autocapture
          >
            {page}
          </Link>
        )
      })}

      {/* Next */}
      {currentPage < totalPages ? (
        <Link
          href={buildPageUrl(pathname, searchParams, currentPage + 1)}
          className={navLinkClass}
          aria-label={t('pagination.nextAria')}
          scroll={false}
          onClick={() =>
            trackDirectoryPageNavigated(currentPage + 1, 'next', totalPages)
          }
          data-ph-no-autocapture
        >
          {t('pagination.next')}
        </Link>
      ) : (
        <span className="inline-flex min-h-12 items-center justify-center rounded-lg px-3 type-body-emphasis text-foreground/20">
          {t('pagination.next')}
        </span>
      )}
    </nav>
  )
}
