'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type DirectoryFilterTokenProps = {
  href: string
  label: string
  removeLabel: string
  value: string
  variant: 'row' | 'chip'
}

export function DirectoryFilterToken({
  href,
  label,
  removeLabel,
  value,
  variant,
}: DirectoryFilterTokenProps) {
  return (
    <Link
      aria-label={removeLabel}
      className={cn(
        buttonVariants({
          variant: 'secondary',
          shape: variant === 'chip' ? 'pill' : 'default',
        }),
        'h-auto min-h-12 justify-between gap-3',
        variant === 'row' ? 'w-full px-3 text-left' : 'px-4',
      )}
      href={href}
      replace
      scroll={false}
    >
      <span className="min-w-0 truncate">
        <span className="font-medium text-foreground">{label}:</span>{' '}
        <span className="text-muted-foreground">{value}</span>
      </span>
      <X className="size-4" aria-hidden="true" />
    </Link>
  )
}
