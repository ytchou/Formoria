'use client'

import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function ReputationSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'reputationSources',
  })

  return (
    <section id="reputation" className="space-y-4">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionReputation')}
      </h2>

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="space-y-2">
          <Label htmlFor="reputationSummary">
            {t('fieldReputationSummary')}
          </Label>
          <Textarea
            id="reputationSummary"
            className="min-h-28 bg-card"
            {...form.register('reputationSummary')}
          />
        </div>
        <div className="space-y-3">
          <Label>{t('fieldProvenanceSources')}</Label>
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_48px]"
            >
              <Input
                className="min-h-12 bg-card"
                type="url"
                placeholder={t('fieldSourceUrlPlaceholder')}
                {...form.register(`reputationSources.${index}.url`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('removeItem')}
                className="h-12 w-12"
                onClick={() => remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="min-h-12"
            disabled={fields.length >= 5}
            onClick={() => append({ url: '' })}
          >
            {t('addSource')}
          </Button>
        </div>
      </div>
    </section>
  )
}
