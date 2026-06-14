'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type AdminSubNavTab = {
  label: string
  href: string
  count?: number
}

type AdminSubNavProps = {
  tabs: AdminSubNavTab[]
}

export function AdminSubNav({ tabs }: AdminSubNavProps) {
  const pathname = usePathname()

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <nav className="border-b bg-white">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-1 px-10">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
              isActive(tab.href) && 'border-cta text-foreground'
            )}
          >
            {tab.label}
            {tab.count ? (
              <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                {tab.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  )
}
