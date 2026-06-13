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
    <nav className="bg-accent">
      <div className="mx-auto flex h-16 max-w-screen-xl items-center gap-8 px-10">
        <span className="font-heading text-lg font-bold text-white">
          管理後台
        </span>

        <div className="flex items-center gap-1">
          {navLinks.map((link) => {
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive(link.href)
                    ? 'border-b-2 border-cta text-white'
                    : 'text-white/70 hover:text-white'
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
