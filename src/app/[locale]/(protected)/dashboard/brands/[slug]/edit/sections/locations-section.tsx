'use client'

import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function LocationsSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'retailLocations',
  })

  return (
    <section id="locations" className="space-y-4">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionLocations')}
      </h2>

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_48px]">
            <Input className="min-h-12 bg-card" placeholder={t('fieldStoreName')} {...form.register(`retailLocations.${index}.name`)} />
            <Input className="min-h-12 bg-card" placeholder={t('fieldAddress')} {...form.register(`retailLocations.${index}.address`)} />
            <Button type="button" variant="ghost" size="icon" aria-label={t('removeItem')} className="h-12 w-12" onClick={() => remove(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" className="min-h-12" onClick={() => append({ name: '', address: '' })}>
          {t('addRetailLocation')}
        </Button>
      </div>
    </section>
  )
}
