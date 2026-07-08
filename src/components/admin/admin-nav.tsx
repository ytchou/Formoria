'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type NavChild = {
  label: string
  href: string
  count?: number
}

export type NavItem = {
  label: string
  href: string
  children?: NavChild[]
}

type AdminNavProps = {
  items: NavItem[]
}

export function AdminNav({ items }: AdminNavProps) {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  return (
    <nav className="mt-6 flex flex-wrap gap-1 border-b border-border">
      {items.map((item) =>
        item.children ? (
          <NavItemWithDropdown
            key={item.href}
            item={item}
            isActive={isActive(item.href)}
            pathname={pathname}
          />
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              isActive(item.href)
                ? 'border-cta text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {item.label}
          </Link>
        )
      )}
    </nav>
  )
}

function NavItemWithDropdown({
  item,
  isActive,
  pathname,
}: {
  item: NavItem
  isActive: boolean
  pathname: string
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleEnter() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setOpen(true)
  }

  function handleLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <div
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <Link
        href={item.href}
        className={cn(
          '-mb-px flex items-center gap-1 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'border-cta text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        )}
      >
        {item.label}
        <ChevronDownIcon className="size-3.5 opacity-50" />
      </Link>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-px min-w-48 rounded-md border bg-popover p-1 shadow-md">
          {item.children!.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center justify-between gap-3 rounded-sm px-3 py-2 text-sm transition-colors hover:bg-accent',
                pathname === child.href || pathname.startsWith(`${child.href}/`)
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {child.label}
              {child.count ? (
                <span className="rounded-full bg-muted px-2 py-0.5 type-caption">
                  {child.count}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
