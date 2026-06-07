'use client'

import { Globe } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Link, usePathname } from '@/i18n/navigation'

export function LocaleSwitcher() {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('nav')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('languageLabel')}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Globe className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 min-w-36">
        <DropdownMenuItem
          className={locale === 'zh-TW' ? 'font-medium' : undefined}
          render={
            <Link
              href={pathname}
              locale="zh-TW"
              aria-current={locale === 'zh-TW' ? 'true' : undefined}
            />
          }
        >
          中文
        </DropdownMenuItem>
        <DropdownMenuItem
          className={locale === 'en' ? 'font-medium' : undefined}
          render={
            <Link
              href={pathname}
              locale="en"
              aria-current={locale === 'en' ? 'true' : undefined}
            />
          }
        >
          English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
