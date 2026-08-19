'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { NativeSelect } from '@/components/ui/native-select'
import { dateRangeForPastDays, formatIsoDate } from '@/lib/date-range'

type AnalyticsPeriodPickerProps = {
  currentPeriod: number
}

export function AnalyticsPeriodPicker({ currentPeriod }: AnalyticsPeriodPickerProps) {
  const t = useTranslations('dashboard.period')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const range = dateRangeForPastDays(currentPeriod)

  return (
    <div className="flex items-center gap-2">
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
      <span className="type-metadata truncate text-muted-foreground">
        {`${formatIsoDate(range.start, locale, false)} – ${formatIsoDate(range.end, locale, false)}`}
      </span>
    </div>
  )
}
