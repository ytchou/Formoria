'use client'

import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

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
  const labelKey = variant === 'newsletter-only'
    ? 'newsletterOnlyLabel'
    : 'combinedLabel'

  return (
    <div className="space-y-1">
      <Label
        htmlFor={id}
        className="flex min-h-12 cursor-pointer items-start gap-3"
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
        <span className="type-body font-normal">{t(labelKey)}</span>
      </Label>
      {variant === 'newsletter-and-lifecycle' ? (
        <p className="pl-[30px] type-form-hint">
          {t.rich('combinedDescription', {
            privacyPolicy: (chunks) => (
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      ) : null}
    </div>
  )
}
