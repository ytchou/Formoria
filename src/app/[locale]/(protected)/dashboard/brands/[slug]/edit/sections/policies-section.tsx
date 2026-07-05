'use client'

import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller } from 'react-hook-form'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function PoliciesSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')

  return (
    <section id="policies" className="space-y-4">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionPolicies')}
      </h2>

      <div className="grid gap-4 rounded-lg border border-border bg-card p-4">
        <div className="space-y-2">
          <Label htmlFor="returnsPolicy" className="text-sm font-semibold text-foreground">
            Returns policy
          </Label>
          <Textarea id="returnsPolicy" className="min-h-28 bg-card" {...form.register('returnsPolicy')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="warranty" className="text-sm font-semibold text-foreground">
            Warranty
          </Label>
          <Textarea id="warranty" className="min-h-28 bg-card" {...form.register('warranty')} />
        </div>
        <div className="flex min-h-12 items-center gap-3">
          <Controller
            control={form.control}
            name="shipsInternational"
            render={({ field }) => (
              <Checkbox
                id="shipsInternational"
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
                className="accent-primary"
              />
            )}
          />
          <Label htmlFor="shipsInternational" className="text-sm font-semibold text-foreground">
            Ships international
          </Label>
        </div>
      </div>
    </section>
  )
}
