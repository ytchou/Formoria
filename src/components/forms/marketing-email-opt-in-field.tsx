'use client'

import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Link } from '@/i18n/navigation'
import { routes } from '@/lib/routes'

type MarketingEmailOptInFieldProps = {
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  name?: string
  disabled?: boolean
}

export function MarketingEmailOptInField({
  id,
  checked,
  onCheckedChange,
  name,
  disabled,
}: MarketingEmailOptInFieldProps) {
  const t = useTranslations('marketingEmailConsent')

  const labelId = `${id}-label`
  const descriptionId = `${id}-description`

  return (
    // The helper sits in the label's text column, one block with the label
    // (SP2-21): as a sibling under a min-h-12 label it landed a row away on
    // mobile and read as a separate paragraph. aria-labelledby keeps the
    // checkbox's name to the label line; the helper is its description.
    <Label
      htmlFor={id}
      className="flex min-h-12 cursor-pointer items-start gap-3 sm:min-h-0"
    >
      <Checkbox
        id={id}
        name={name}
        value="true"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 size-[18px] shrink-0"
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
      />
      <span className="flex flex-col gap-1">
        <span id={labelId} className="type-body-sm text-ink-soft font-normal">
          {t('newsletterOnlyLabel')}
        </span>
        <span id={descriptionId} className="type-metadata">
          {t.rich('newsletterOnlyDescription', {
            privacyPolicy: (chunks) => (
              <Link
                href={routes.privacy()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {chunks}
              </Link>
            ),
          })}
        </span>
      </span>
    </Label>
  )
}
