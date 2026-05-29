'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navLinks = [
  { label: '管理後台', href: '/admin' },
  { label: '待審核提交', href: '/admin/submissions' },
  { label: '品牌', href: '/admin/brands' },
  { label: '分類管理', href: '/admin/taxonomy' },
  { label: '已標記', href: '/admin/flagged' },
  { label: '檢舉', href: '/admin/reports' },
]

export function AdminNav() {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  return (
    <nav className="bg-[#2C1810]">
      <div className="mx-auto flex h-16 max-w-screen-xl items-center gap-8 px-10">
        <span className="font-heading text-lg font-bold text-white">
          管理後台
        </span>

        <div className="flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive(link.href)
                  ? 'border-b-2 border-[#E06B3F] text-white'
                  : 'text-white/70 hover:text-white'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
