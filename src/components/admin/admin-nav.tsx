'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navLinks: { label: string; href: string }[] = [
  { label: '總覽', href: '/admin' },
  { label: '審核佇列', href: '/admin/review-queue' },
  { label: '認領申請', href: '/admin/claims' },
  { label: '信號', href: '/admin/signals' },
  { label: '目錄管理', href: '/admin/catalog' },
]

export function AdminNav() {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  return (
    <nav className="mt-6 flex flex-wrap gap-1 border-b border-border">
      {navLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            isActive(link.href)
              ? 'border-cta text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
