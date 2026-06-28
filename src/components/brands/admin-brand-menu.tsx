'use client'

import { Eye, Pencil, Settings } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface AdminBrandMenuProps {
  brandSlug: string
}

export function AdminBrandMenu({ brandSlug }: AdminBrandMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Admin menu"
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-transparent text-muted-foreground transition-colors hover:bg-secondary"
      >
        <Settings className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href={`/dashboard/brands/${brandSlug}`} />}>
          <Eye className="size-4" />
          View as owner
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/dashboard/brands/${brandSlug}/edit`} />}>
          <Pencil className="size-4" />
          Edit brand
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
