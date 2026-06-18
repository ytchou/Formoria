'use client'

import { useActionState, useState } from 'react'
import { useTranslations } from 'next-intl'

import { subscribeToNewsletter } from '@/app/actions/newsletter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const INTEREST_CHIPS = [
  { slug: 'brand-stories', labelKey: 'brand stories' },
  { slug: 'new-brands', labelKey: 'new brands' },
  { slug: 'curated-picks', labelKey: 'curated picks' },
  { slug: 'mit-trends', labelKey: 'mit trends' },
] as const

export function EmailCaptureForm() {
  const t = useTranslations('newsletter')
  const [state, formAction, isPending] = useActionState(subscribeToNewsletter, {})
  const [selectedChips, setSelectedChips] = useState<string[]>(['new-brands'])

  function toggleChip(slug: string) {
    setSelectedChips((current) =>
      current.includes(slug)
        ? current.filter((selectedSlug) => selectedSlug !== slug)
        : [...current, slug]
    )
  }

  if (state.success) {
    return (
      <div className="rounded-lg bg-[#EAF3E8] px-4 py-3 text-sm font-medium text-[#2D5A27]">
        {t('success')}
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4 bg-[#F5F4F1] text-[#1C1C1C]">
      <input
        aria-hidden="true"
        autoComplete="off"
        className="sr-only"
        name="website"
        tabIndex={-1}
        type="text"
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Input
            aria-invalid={state.error ? 'true' : undefined}
            className="h-12 rounded-lg border-[#D4D4D4] bg-white focus-visible:border-[color:var(--cta)] focus-visible:ring-[color:var(--cta)]/20 sm:h-11"
            name="email"
            placeholder={t('email placeholder')}
            required
            type="email"
          />
          {state.error ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
        </div>

        <Button
          className="h-12 rounded-lg bg-[color:var(--cta)] px-6 text-white hover:bg-[color:var(--cta)]/90 sm:h-11"
          disabled={isPending}
          type="submit"
        >
          {isPending ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          ) : null}
          {t('subscribe')}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[#6B6B6B]">
          {t('choose what interests you')}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap">
          {INTEREST_CHIPS.map((chip) => {
            const isSelected = selectedChips.includes(chip.slug)

            return (
              <button
                key={chip.slug}
                aria-pressed={isSelected}
                className={cn(
                  'h-9 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[color:var(--cta)]/20',
                  isSelected
                    ? 'border-[#1C1C1C] bg-[#1C1C1C] text-white'
                    : 'border-foreground bg-transparent text-foreground hover:bg-white/60'
                )}
                type="button"
                onClick={() => toggleChip(chip.slug)}
              >
                {t(chip.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      {selectedChips.map((slug) => (
        <input key={slug} name="interests" type="hidden" value={slug} />
      ))}
    </form>
  )
}
