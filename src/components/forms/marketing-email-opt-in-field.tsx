'use client'

import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Link } from '@/i18n/navigation'
import { routes } from '@/lib/routes'

type MarketingEmailOptInFieldProps = {
  id: string
  variant: 'newsletter-only' | 'newsletter-and-lifecycle'
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  name?: string
  disabled?: boolean
}

export function MarketingEmailOptInField({
  id,
  variant,
  checked,
  onCheckedChange,
  name,
  disabled,
}: MarketingEmailOptInFieldProps) {
  const t = useTranslations('marketingEmailConsent')
  const isNewsletterOnly = variant === 'newsletter-only'
  const labelKey = isNewsletterOnly ? 'newsletterOnlyLabel' : 'combinedLabel'
  const descriptionKey = isNewsletterOnly
    ? 'newsletterOnlyDescription'
    : 'combinedDescription'

  return (
    <div className="space-y-1">
      {/* min-h-12 keeps the mobile tap target; on wider screens the label is a
          single line and the slack would push the description a row away. */}
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
        />
        <span className="type-body-sm text-ink-soft font-normal">{t(labelKey)}</span>
      </Label>
      <p className="pl-[30px] type-metadata">
        {t.rich(descriptionKey, {
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
      </p>
    </div>
  )
}
