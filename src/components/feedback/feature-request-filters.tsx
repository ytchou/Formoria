import { useTranslations } from 'next-intl'

import { buttonVariants } from '@/components/ui/button'
import { toggleChipSelectedClasses } from '@/components/ui/toggle-chip'
import { Link } from '@/i18n/navigation'
import type { FeatureRequestCategory } from '@/lib/services/feature-requests'
import { cn } from '@/lib/utils'

const CATEGORY_OPTIONS: readonly (FeatureRequestCategory | null)[] = [
  null,
  'owner',
  'visitor',
]

/**
 * Chips are links, not buttons: the filter lives entirely in the query string,
 * so the board filters with JavaScript disabled and every state is shareable.
 *
 * 8px between 32px chips is the documented touch-target exception — the chips
 * sit in their own row with nothing tappable above or below them.
 */
export function FeatureRequestFilters({
  active,
}: {
  active: FeatureRequestCategory | null
}) {
  const t = useTranslations('feedback.filters')

  return (
    <nav aria-label={t('label')}>
      <ul className="flex flex-wrap gap-2">
        {CATEGORY_OPTIONS.map((category) => {
          const selected = category === active

          return (
            <li key={category ?? 'all'}>
              <Link
                href={category ? `/feedback?category=${category}` : '/feedback'}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  buttonVariants({
                    variant: 'secondary',
                    shape: 'pill',
                    size: 'chip',
                  }),
                  // ToggleChip's own selected treatment, imported rather than
                  // cloned. The chip stays a real <Link> — it needs no
                  // `pressed` handler, and `aria-pressed` would be invalid on
                  // an anchor — but it must never drift from the button chips.
                  selected && toggleChipSelectedClasses,
                )}
              >
                {t(category ?? 'all')}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
