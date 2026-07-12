'use client'

import { useActionState, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { subscribeToNewsletter } from '@/app/actions/newsletter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const INTEREST_CHIPS = [
  { slug: 'curated-picks', labelKey: 'interests.curated-picks' },
  { slug: 'brand-stories', labelKey: 'interests.brand-stories' },
  { slug: 'new-brands', labelKey: 'interests.new-brands' },
  { slug: 'mit-trends', labelKey: 'interests.mit-trends' },
] as const

export function EmailCaptureForm() {
  const locale = useLocale()
  const t = useTranslations('newsletter')
  const [state, formAction, isPending] = useActionState(subscribeToNewsletter, {})
  const [selectedChips, setSelectedChips] = useState<string[]>(['curated-picks'])

  function toggleChip(slug: string) {
    setSelectedChips((current) =>
      current.includes(slug)
        ? current.filter((selectedSlug) => selectedSlug !== slug)
        : [...current, slug]
    )
  }

  if (state.success) {
    return (
      <div className="rounded-lg bg-verified-green-bg px-4 py-3 text-sm font-medium text-verified-green">
        {t('success')}
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4 text-foreground">
      <input
        aria-hidden="true"
        autoComplete="off"
        className="sr-only"
        name="website"
        tabIndex={-1}
        type="text"
      />
      <input type="hidden" name="locale" value={locale} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Input
            aria-invalid={state.error ? 'true' : undefined}
            className="h-12 rounded-lg border-border bg-background/50 text-foreground placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-ring sm:h-11"
            name="email"
            placeholder={t('emailPlaceholder')}
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
          variant="primary" tone="cta"
          disabled={isPending}
          type="submit"
        >
          {isPending ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current/40 border-t-current"
            />
          ) : null}
          {t('subscribe')}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-secondary-foreground">
          {t('interestsLabel')}
        </p>
        <div className="flex flex-row gap-2 overflow-x-auto">
          {INTEREST_CHIPS.map((chip) => {
            const isSelected = selectedChips.includes(chip.slug)

            return (
              <button
                key={chip.slug}
                aria-pressed={isSelected}
                className={cn(
                  'h-9 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring',
                  isSelected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-secondary-foreground hover:bg-muted'
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
