'use client'

import { useTransition } from 'react'
import { Eye, Settings } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { startImpersonationAction } from '@/lib/actions/impersonation'

interface AdminBrandMenuProps {
  brandSlug: string
}

export function AdminBrandMenu({ brandSlug }: AdminBrandMenuProps) {
  const t = useTranslations('brandDetail.adminMenu')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleViewAsOwner() {
    startTransition(async () => {
      const result = await startImpersonationAction(brandSlug)
      if (result.ok) {
        router.push(`/dashboard/brands/${brandSlug}`)
      }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('label')}
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-transparent text-muted-foreground transition-colors hover:bg-secondary"
      >
        <Settings className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isPending} onClick={handleViewAsOwner}>
          <Eye className="size-4" />
          {t('viewAsOwner')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
