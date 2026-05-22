'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'

const navLinks = [
  { label: '瀏覽', href: '/' },
  { label: '關於', href: '/about' },
]

export function MainNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <header className="sticky top-0 z-50 h-[var(--nav-height)] border-b border-border bg-card">
      <nav className="mx-auto flex h-full max-w-screen-xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            M
          </div>
          <span className="font-heading text-base font-bold text-foreground">
            MIT Map
          </span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                isActive(link.href)
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-secondary text-foreground hover:bg-accent/10'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <Link
          href="/submit"
          className="hidden rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:inline-flex"
        >
          提交品牌
        </Link>

        {/* Mobile menu */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetPrimitive.Trigger
            render={
              <button
                className="inline-flex size-10 items-center justify-center rounded-lg md:hidden"
                aria-label="Open menu"
              />
            }
          >
            <Menu className="size-5" />
          </SheetPrimitive.Trigger>
          <SheetContent side="right" className="w-72">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex flex-col gap-4 pt-8">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`block rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                    isActive(link.href)
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-secondary'
                  }`}
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/submit"
                className="block rounded-full bg-primary px-5 py-3 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                onClick={() => setOpen(false)}
              >
                提交品牌
              </Link>
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </header>
  )
}
