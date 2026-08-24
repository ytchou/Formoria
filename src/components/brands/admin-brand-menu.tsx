'use client'

import { useTransition } from 'react'
import { EyeOff, Pencil, Settings } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter as useAdminRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { hideBrandAction } from '@/app/admin/actions'
import { Button } from '@/components/ui/button'
import { useUser } from '@/lib/auth/use-user'
import { routes } from '@/lib/routes'

interface AdminBrandMenuProps {
  brandId: string
  brandName: string
}

export function AdminBrandMenu({ brandId, brandName }: AdminBrandMenuProps) {
  const t = useTranslations('brandDetail.adminMenu')
  const adminRouter = useAdminRouter()
  const [isPending, startTransition] = useTransition()
  const { viewer, viewerLoading } = useUser()

  if (viewerLoading || !viewer.isAdmin) return null

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
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-ink-muted hover:bg-surface"
          />
        }
      >
        <Settings className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLinkItem
          href={routes.admin.brands({ edit: brandId })}
        >
          <Pencil className="size-4" />
          {t('editFields')}
        </DropdownMenuLinkItem>
        <DropdownMenuItem
          className="text-danger focus:text-danger"
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
