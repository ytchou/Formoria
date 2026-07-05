'use client'

import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type UseFormReturn, Controller, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
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
import { TAIWAN_CITIES } from '@/lib/constants/taiwan-cities'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'

export function BasicInfoSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const t = useTranslations('dashboard.edit')
  const tCities = useTranslations('cities')
  const tx = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback)
  const {
    fields: productTagFields,
    append,
    remove,
  } = useFieldArray({
    control: form.control,
    name: 'productTags' as never,
  })

  return (
    <section id="basic-info" className="space-y-4">
      <h2 className="font-heading text-base font-bold border-b border-border pb-2 mb-4">
        {t('sectionBasicInfo')}
      </h2>

      <div className="space-y-2">
        <Label htmlFor="name">{t('fieldBrandName')}</Label>
        <Input id="name" className="min-h-12 bg-card" {...form.register('name')} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="productType">{t('fieldCategory')}</Label>
        <Controller
          control={form.control}
          name="productType"
          render={({ field }) => (
            <Select value={field.value ?? ''} onValueChange={field.onChange}>
              <SelectTrigger id="productType" className="min-h-12 w-full bg-card">
                <SelectValue placeholder={t('fieldCategory')} />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_TYPE_CATEGORIES.map((category) => (
                  <SelectItem key={category.slug} value={category.slug}>
                    {category.nameZh} ({category.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{t('fieldDescription')}</Label>
        <Textarea
          id="description"
          className="min-h-28 bg-card"
          {...form.register('description')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="foundingYear">{t('fieldFoundingYear')}</Label>
        <Input
          id="foundingYear"
          type="number"
          min={1900}
          max={new Date().getFullYear()}
          className="min-h-12 bg-card"
          {...form.register('foundingYear')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mitStory">{t('mitStoryLabel')}</Label>
        <Textarea
          id="mitStory"
          rows={5}
          placeholder={t('mitStoryPlaceholder')}
          className="min-h-28 bg-card"
          {...form.register('mitStory')}
        />
      </div>

      <div className="space-y-2">
        <Label>{tx('fieldProductTags', 'Product tags')}</Label>
        <div className="space-y-3">
          {productTagFields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <Input
                aria-label={`${tx('fieldProductTags', 'Product tags')} ${index + 1}`}
                className="min-h-12 bg-card"
                {...form.register(`productTags.${index}`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={tx('removeProductTag', 'Remove tag')}
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
            disabled={productTagFields.length >= 5}
            onClick={() => append('' as never)}
          >
            {tx('fieldProductTagsPlaceholder', 'Add a specific product type')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {tx('productTagsMax', 'Up to 5 product tags')}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="city">{t('city')}</Label>
        <Controller
          control={form.control}
          name="city"
          render={({ field }) => (
            <Select value={field.value ?? ''} onValueChange={field.onChange}>
              <SelectTrigger id="city" className="min-h-12 w-full bg-card">
                <SelectValue placeholder={t('cityPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {TAIWAN_CITIES.map((city) => (
                  <SelectItem key={city.slug} value={city.slug}>
                    {tCities(city.slug)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="priceRange">{tx('fieldPriceRange', 'Price Range')}</Label>
        <Controller
          control={form.control}
          name="priceRange"
          render={({ field }) => (
            <Select
              value={field.value == null ? '' : String(field.value)}
              onValueChange={field.onChange}
            >
              <SelectTrigger id="priceRange" className="min-h-12 w-full bg-card">
                <SelectValue placeholder={tx('fieldPriceRangeUnset', 'Unset')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">$</SelectItem>
                <SelectItem value="2">$$</SelectItem>
                <SelectItem value="3">$$$</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>
    </section>
  )
}
