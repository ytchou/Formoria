'use client'

import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'

export function ManufacturingSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')

  return (
    <section id="manufacturing" className="space-y-4">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionManufacturing')}
      </h2>

      <div className="grid gap-4 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
          <Label htmlFor="factoryLocation" className="text-sm font-semibold text-foreground">
            {t('fieldFactoryLocation')}
          </Label>
          <Input id="factoryLocation" className="min-h-12 bg-card" {...form.register('factoryLocation')} />
        </div>
        <div className="grid gap-1.5 sm:grid-cols-[140px_1fr] sm:items-center">
          <Label htmlFor="productionModel" className="text-sm font-semibold text-foreground">
            {t('fieldProductionModel')}
          </Label>
          <Controller
            control={form.control}
            name="productionModel"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger id="productionModel" className="min-h-12 w-full bg-card">
                  <SelectValue placeholder={t('fieldProductionModelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="own">{t('productionModelOwn')}</SelectItem>
                  <SelectItem value="oem">{t('productionModelOem')}</SelectItem>
                  <SelectItem value="mixed">{t('productionModelMixed')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="manufacturingNotes" className="text-sm font-semibold text-foreground">
            {t('fieldManufacturingNotes')}
          </Label>
          <Textarea id="manufacturingNotes" className="min-h-28 bg-card" {...form.register('manufacturingNotes')} />
        </div>
      </div>
    </section>
  )
}
