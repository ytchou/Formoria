'use client'

import { useTransition } from 'react'
import { Eye, EyeOff, Pencil, Settings } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter as useAdminRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useRouter } from '@/i18n/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { startImpersonationAction } from '@/lib/actions/impersonation'
import { hideBrandAction } from '@/app/admin/actions'
import { useUser } from '@/lib/auth/use-user'
import { routes } from '@/lib/routes'

interface AdminBrandMenuProps {
  brandId: string
  brandName: string
  brandSlug: string
}

export function AdminBrandMenu({ brandId, brandName, brandSlug }: AdminBrandMenuProps) {
  const t = useTranslations('brandDetail.adminMenu')
  const router = useRouter()
  const adminRouter = useAdminRouter()
  const [isPending, startTransition] = useTransition()
  const { viewer, viewerLoading, refreshViewer } = useUser()

  if (viewerLoading || !viewer.isAdmin) return null

  function handleViewAsOwner() {
    startTransition(async () => {
      const result = await startImpersonationAction(brandSlug)
      if (result.ok) {
        await refreshViewer()
        router.push(routes.dashboard.brand(brandSlug))
      }
    })
  }

  function handleHideBrand() {
    startTransition(async () => {
      const result = await hideBrandAction(brandId)
      if (result?.error) {
        toast.error(result.error)
        return
      }

      const params = new URLSearchParams({ status: 'hidden', search: brandName })
      adminRouter.push(`${routes.admin.brands()}?${params}`)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('label')}
        className="flex size-12 items-center justify-center rounded-xl bg-transparent text-muted-foreground transition-colors hover:bg-secondary"
      >
        <Settings className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isPending} onClick={handleViewAsOwner}>
          <Eye className="size-4" />
          {t('viewAsOwner')}
        </DropdownMenuItem>
        <DropdownMenuLinkItem
          href={routes.admin.brands({ edit: brandId })}
        >
          <Pencil className="size-4" />
          {t('editFields')}
        </DropdownMenuLinkItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={isPending}
          onClick={handleHideBrand}
        >
          <EyeOff className="size-4" />
          {t('hideBrand')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
