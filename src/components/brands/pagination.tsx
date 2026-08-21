'use client'

import Link, { useLinkStatus } from 'next/link'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { usePathname, useSearchParams } from 'next/navigation'
import { trackDirectoryPageNavigated } from '@/lib/analytics'
import { getPageRange } from '@/lib/pagination'

interface PaginationProps {
  totalCount: number
  currentPage: number
  pageSize: number
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
  'relative inline-flex min-h-12 items-center justify-center rounded-[4px] px-3 type-nav text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const pageLinkClass =
  'relative inline-flex min-h-12 min-w-12 items-center justify-center rounded-[4px] type-nav text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

function PaginationLinkStatus() {
  const { pending } = useLinkStatus()

  return (
    <Loader2
      aria-hidden="true"
      className={`pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 transition-opacity ${pending ? 'animate-spin opacity-100' : 'opacity-0'}`}
    />
  )
}

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
    <nav aria-label={t('pagination.label')} className="mt-10 flex items-center justify-center gap-1">
      {/* Previous */}
      {currentPage > 1 ? (
        <Link
          href={buildPageUrl(pathname, searchParams, currentPage - 1)}
          className={navLinkClass}
          aria-label={t('pagination.previousAria')}
          prefetch={false}
          scroll={false}
          onClick={() =>
            trackDirectoryPageNavigated(currentPage - 1, 'prev', totalPages)
          }
          data-ph-no-autocapture
        >
          {t('pagination.previous')}
          <PaginationLinkStatus />
        </Link>
      ) : (
        <span className="inline-flex min-h-12 items-center justify-center rounded-[4px] px-3 type-nav text-ink-muted/50">
          {t('pagination.previous')}
        </span>
      )}

      {/* Page numbers */}
      {pages.map((page, i) => {
        if (page === 'ellipsis') {
          return (
            <span
              key={`ellipsis-${i}`}
              className="inline-flex min-h-12 min-w-12 items-center justify-center type-nav text-ink-muted"
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
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-[4px] bg-accent type-nav text-ground"
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
            prefetch={false}
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
            <PaginationLinkStatus />
          </Link>
        )
      })}

      {/* Next */}
      {currentPage < totalPages ? (
        <Link
          href={buildPageUrl(pathname, searchParams, currentPage + 1)}
          className={navLinkClass}
          aria-label={t('pagination.nextAria')}
          prefetch={false}
          scroll={false}
          onClick={() =>
            trackDirectoryPageNavigated(currentPage + 1, 'next', totalPages)
          }
          data-ph-no-autocapture
        >
          {t('pagination.next')}
          <PaginationLinkStatus />
        </Link>
      ) : (
        <span className="inline-flex min-h-12 items-center justify-center rounded-[4px] px-3 type-nav text-ink-muted/50">
          {t('pagination.next')}
        </span>
      )}
    </nav>
  )
}
