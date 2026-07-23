'use client'

import { Calendar } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { NativeSelect } from '@/components/ui/native-select'

type AnalyticsPeriodPickerProps = {
  currentPeriod: number
}

export function AnalyticsPeriodPicker({ currentPeriod }: AnalyticsPeriodPickerProps) {
  const t = useTranslations('dashboard.period')
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const now = new Date()
  const end = now
  const start = new Date(now)
  start.setDate(start.getDate() - currentPeriod)
  const format = (date: Date) => date.toLocaleDateString('zh-TW', {
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <NativeSelect
        aria-label={t('periodLabel')}
        className="w-fit"
        value={currentPeriod}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString())
          params.set('period', event.target.value)
          router.replace(`${pathname}?${params.toString()}`)
        }}
      >
        {([7, 30, 90] as const).map((period) => (
          <option key={period} value={period}>
            {t(`${period}d`)}
          </option>
        ))}
      </NativeSelect>
      <p className="flex items-center gap-1.5 type-caption text-muted-foreground">
        <Calendar aria-hidden="true" className="size-4" />
        {format(start)} – {format(end)}
      </p>
    </div>
  )
}
