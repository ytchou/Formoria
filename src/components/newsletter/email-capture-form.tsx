'use client'

import { useActionState, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { subscribeToNewsletter } from '@/app/actions/newsletter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
      <div className="rounded-lg bg-verified-green-bg px-4 py-3 type-body-emphasis text-verified-green">
        {t('success')}
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4 text-foreground">
      {/* eslint-disable no-restricted-syntax -- ui-exception: honeypot anti-spam field must be raw HTML */}
      <input
        aria-hidden="true"
        autoComplete="off"
        className="sr-only"
        name="website"
        tabIndex={-1}
        type="text"
      />
      {/* eslint-enable no-restricted-syntax */}
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
        <p className="type-body-emphasis text-secondary-foreground">
          {t('interestsLabel')}
        </p>
        <div className="flex flex-row gap-2 overflow-x-auto">
          {INTEREST_CHIPS.map((chip) => {
            const isSelected = selectedChips.includes(chip.slug)

            return (
              <Button
                key={chip.slug}
                variant={isSelected ? 'primary' : 'secondary'}
                shape="pill"
                size="chip"
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleChip(chip.slug)}
              >
                {t(chip.labelKey)}
              </Button>
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
