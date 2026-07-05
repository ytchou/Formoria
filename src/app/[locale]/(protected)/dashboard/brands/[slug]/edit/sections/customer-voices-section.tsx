'use client'

import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function CustomerVoicesSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'customerVoices',
  })

  return (
    <section id="customer-voices" className="space-y-4">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionCustomerVoices')}
      </h2>

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-foreground">
          {t('customerVoicesLabel')}
        </div>
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid gap-2 sm:grid-cols-[minmax(0,0.35fr)_minmax(0,1fr)_minmax(0,0.35fr)_48px]">
              <Input className="min-h-12 bg-card" placeholder={t('fieldCustomerVoiceAuthor')} {...form.register(`customerVoices.${index}.author`)} />
              <Input className="min-h-12 bg-card" placeholder={t('fieldCustomerVoiceContent')} {...form.register(`customerVoices.${index}.content`)} />
              <Input className="min-h-12 bg-card" placeholder={t('fieldCustomerVoiceSource')} {...form.register(`customerVoices.${index}.source`)} />
              <Button type="button" variant="ghost" size="icon" aria-label={t('removeItem')} className="h-12 w-12" onClick={() => remove(index)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" className="min-h-12" disabled={fields.length >= 5} onClick={() => append({ author: '', content: '', source: '' })}>
            {t('addCustomerVoice')}
          </Button>
        </div>
      </div>
    </section>
  )
}
