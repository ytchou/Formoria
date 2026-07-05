'use client'

import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function CertificationsSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'certifications',
  })

  return (
    <section id="certifications" className="space-y-4">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionCertifications')}
      </h2>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        {fields.map((field, index) => (
          <div key={field.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.5fr)_minmax(0,1fr)_48px]">
            <Input className="min-h-12 bg-card" placeholder="Certification name" {...form.register(`certifications.${index}.name`)} />
            <Input className="min-h-12 bg-card" placeholder="Issuer" {...form.register(`certifications.${index}.issuer`)} />
            <Input className="min-h-12 bg-card" type="number" min={1900} max={new Date().getFullYear()} placeholder="Year" {...form.register(`certifications.${index}.year`)} />
            <Input className="min-h-12 bg-card" type="url" placeholder="Source URL" {...form.register(`certifications.${index}.sourceUrl`)} />
            <Button type="button" variant="ghost" size="icon" aria-label={t('removeItem')} className="h-12 w-12" onClick={() => remove(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" className="min-h-12" disabled={fields.length >= 10} onClick={() => append({ name: '', issuer: '', year: '', sourceUrl: '' })}>
          Add certification
        </Button>
      </div>
    </section>
  )
}
