import Link from 'next/link'

interface PaginationProps {
  totalCount: number
  currentPage: number
  pageSize: number
  basePath?: string
  searchParams?: Record<string, string>
}

function buildPageUrl(
  basePath: string,
  page: number,
  searchParams: Record<string, string>
) {
  const params = new URLSearchParams(searchParams)
  if (page > 1) {
    params.set('page', String(page))
  } else {
    params.delete('page')
  }
  const str = params.toString()
  return str ? `${basePath}?${str}` : basePath
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
  basePath = '/brands',
  searchParams = {},
}: PaginationProps) {
  const totalPages = Math.ceil(totalCount / pageSize)

  if (totalPages <= 1) return null

  const pages = getPageRange(currentPage, totalPages)

  return (
    <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-1">
      {/* Previous */}
      {currentPage > 1 ? (
        <Link
          href={buildPageUrl(basePath, currentPage - 1, searchParams)}
          className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-medium text-foreground/70 transition-colors hover:bg-muted"
          aria-label="Previous page"
        >
          &lsaquo; Prev
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-medium text-foreground/20">
          &lsaquo; Prev
        </span>
      )}

      {/* Page numbers */}
      {pages.map((page, i) => {
        if (page === 'ellipsis') {
          return (
            <span
              key={`ellipsis-${i}`}
              className="inline-flex h-9 w-9 items-center justify-center text-[13px] text-foreground/40"
            >
              ...
            </span>
          )
        }

        const isActive = page === currentPage

        if (isActive) {
          return (
            <span
              key={page}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground"
              aria-current="page"
            >
              {page}
            </span>
          )
        }

        return (
          <Link
            key={page}
            href={buildPageUrl(basePath, page, searchParams)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-medium text-foreground/70 transition-colors hover:bg-muted"
          >
            {page}
          </Link>
        )
      })}

      {/* Next */}
      {currentPage < totalPages ? (
        <Link
          href={buildPageUrl(basePath, currentPage + 1, searchParams)}
          className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-medium text-foreground/70 transition-colors hover:bg-muted"
          aria-label="Next page"
        >
          Next &rsaquo;
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-medium text-foreground/20">
          Next &rsaquo;
        </span>
      )}
    </nav>
  )
}
