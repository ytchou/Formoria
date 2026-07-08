'use client'

import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, useFieldArray } from 'react-hook-form'
import { DashboardFormField } from './dashboard-form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
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
    <StandardFormSection id="reputation">
      <StandardFormStack>
        <h2 className="type-section-title">
          {t('sectionReputation')}
        </h2>

        <DashboardFormField
          id="reputationSummary"
          label={t('fieldReputationSummary')}
          className="px-0 py-0"
        >
          <Textarea
            id="reputationSummary"
            className="min-h-28 bg-card"
            {...form.register('reputationSummary')}
          />
        </DashboardFormField>
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
                aria-label={t('fieldSourceUrlPlaceholder')}
                placeholder={t('fieldSourceUrlPlaceholder')}
                {...form.register(`reputationSources.${index}.url`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={t('removeItem')}
                onClick={() => remove(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={fields.length >= 5}
            onClick={() => append({ url: '' })}
          >
            {t('addSource')}
          </Button>
        </div>
      </StandardFormStack>
    </StandardFormSection>
  )
}
