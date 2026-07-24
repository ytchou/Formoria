'use client'

import { AnimatedNumber } from '@/components/ui/animated-number'

interface HeroStatsProps {
  brandCount: number
  brandLabel: string
  categoryCount: number
  categoryLabel: string
  recentCount?: number
  recentLabel?: string
}

export function HeroStats({
  brandCount,
  brandLabel,
  categoryCount,
  categoryLabel,
  recentCount,
  recentLabel,
}: HeroStatsProps) {
  return (
    <p className="mt-6 type-metadata">
      <AnimatedNumber value={brandCount} /> {brandLabel} ·{' '}
      <AnimatedNumber value={categoryCount} /> {categoryLabel}
      {recentCount != null && recentCount > 0 && recentLabel && (
        <span className="text-primary">
          {' '}· +<AnimatedNumber value={recentCount} /> {recentLabel}
        </span>
      )}
    </p>
  )
}
