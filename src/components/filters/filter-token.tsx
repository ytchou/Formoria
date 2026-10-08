'use client'

import { X } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { taxonomyLinkClasses } from '@/components/ui/toggle-chip'
import { cn } from '@/lib/utils'

// Placeholders the `filters.token` message is formatted with, so the
// locale's separator and ordering come from messages while label and value
// keep their own styling. `t.rich` only accepts string/number/Date arguments
// and the message carries no tags, so the formatted string is split on these.
// Private-use code points: never typed in a label or a search value.
const LABEL_SLOT = '\uE000'
const VALUE_SLOT = '\uE001'
const SLOT_PATTERN = /(\uE000|\uE001)/

type FilterTokenProps = {
  href: string
  label: string
  /** The link's full accessible name; when `badge` is set it must already name the badge. */
  removeLabel: string
  value: string
  variant: 'row' | 'chip'
  /** Visual qualifier after the value (e.g. 自動判斷), hidden from assistive tech. */
  badge?: string
}

export function FilterToken({
  href,
  label,
  removeLabel,
  value,
  variant,
  badge,
}: FilterTokenProps) {
  const t = useTranslations('filters')
  const parts = t('token', { label: LABEL_SLOT, value: VALUE_SLOT })
    .split(SLOT_PATTERN)
    .filter((part) => part !== '')

  return (
    <Link
      aria-label={removeLabel}
      className={
        variant === 'chip'
          ? // The 36px chip exception: render inside a `ChipRow`, which owns
            // the 14px gap that makes 36px a legal target (see toggle-chip.tsx).
            taxonomyLinkClasses({
              className: 'min-w-0 max-w-full justify-between gap-2 bg-surface',
            })
          : cn(
              buttonVariants({ variant: 'secondary', shape: 'default' }),
              'h-auto min-h-12 w-full min-w-0 max-w-full justify-between gap-3 px-3 text-left',
            )
      }
      href={href}
      prefetch={false}
      replace
      scroll={false}
    >
      <span className="min-w-0 truncate">
        {parts.map((part, index) =>
          part === LABEL_SLOT ? (
            <span key={index} className="font-medium text-ink">
              {label}
            </span>
          ) : part === VALUE_SLOT ? (
            <span key={index} className="text-ink-muted">
              {value}
            </span>
          ) : (
            <span key={index} className="font-medium text-ink">
              {part}
            </span>
          ),
        )}
      </span>
      {badge && (
        <Badge variant="outline" aria-hidden="true">
          {badge}
        </Badge>
      )}
      <X className="size-4" aria-hidden="true" />
    </Link>
  )
}

