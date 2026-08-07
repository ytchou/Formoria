'use client'

import { AnimatedNumber } from '@/components/ui/animated-number'

interface HeroStatsProps {
  /** Omitted when the count is unknown; the figure and its separator are dropped. */
  brandCount?: number
  brandLabel: string
  categoryCount: number
  categoryLabel: string
}

export function HeroStats({
  brandCount,
  brandLabel,
  categoryCount,
  categoryLabel,
}: HeroStatsProps) {
  return (
    <p className="mt-6 type-metadata">
      {brandCount != null && (
        <>
          <AnimatedNumber value={brandCount} /> {brandLabel} ·{' '}
        </>
      )}
      <AnimatedNumber value={categoryCount} /> {categoryLabel}
    </p>
  )
}
