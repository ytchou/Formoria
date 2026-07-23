'use client'

import { useState } from 'react'
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import { Menu } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  DashboardSidebar,
  type DashboardSidebarProps,
} from '@/components/dashboard/dashboard-sidebar'

type DashboardMobileHeaderProps = Omit<DashboardSidebarProps, 'className'>

export function DashboardMobileHeader(props: DashboardMobileHeaderProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('dashboard.sidebar')

  return (
    <div className="fixed inset-x-0 top-0 z-40 flex min-h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
      <span className="truncate type-body-emphasis">{props.brandName}</span>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPrimitive.Trigger
          render={
            <button
              aria-label={t('openMenu')}
              // eslint-disable-next-line no-restricted-syntax -- ui-exception: render-prop injection for SheetPrimitive.Trigger, raw button is required by Base UI render prop API
              className={buttonVariants({ variant: 'ghost', size: 'icon' })}
              type="button"
            />
          }
        >
          <Menu aria-hidden="true" className="size-5" />
        </SheetPrimitive.Trigger>
        <SheetContent className="w-72 p-0" side="left">
          <SheetTitle className="sr-only">{t('navLabel')}</SheetTitle>
          <DashboardSidebar
            {...props}
            className="flex w-full flex-col bg-card"
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}
