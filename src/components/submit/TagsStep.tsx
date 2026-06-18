'use client'

import { useState } from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { PRODUCT_TYPE_CATEGORIES } from '@/lib/taxonomy/ontology'
import type { SubmissionFormData } from '@/lib/validations/submission'
import type { TaxonomyTag } from '@/lib/types'

type TagsStepProps = {
  valueTags: TaxonomyTag[]
}

export function TagsStep({ valueTags }: TagsStepProps) {
  const t = useTranslations('submit.fields')
  const [freeTextMode, setFreeTextMode] = useState(false)
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<SubmissionFormData>()

  return (
    <div className="space-y-6">
      {/* Product Type */}
      <fieldset className="space-y-3" aria-label={t('productTypes')}>
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold text-foreground">
            {t('productTypes')}
          </span>
          <p className="text-xs text-muted-foreground">
            {t('productTypesHint')}
          </p>
        </div>

        <Controller
          name="productType"
          control={control}
          render={({ field }) => {
            const selected = field.value ?? ''

            return (
              <div className="grid grid-cols-2 gap-2">
                {PRODUCT_TYPE_CATEGORIES.map((category) => {
                  const checked = selected === category.slug

                  return (
                    <label
                      key={category.slug}
                      htmlFor={`product-type-${category.slug}`}
                      className={`flex items-center gap-2 rounded-xl border p-3 ${
                        freeTextMode
                          ? 'cursor-not-allowed opacity-60'
                          : 'cursor-pointer'
                      } ${
                        checked
                          ? 'border-[#2F5D50] bg-[#F0F5F3]'
                          : 'border-border bg-white hover:border-[#E5E0D8] hover:bg-[#F5F4F1]'
                      }`}
                    >
                      <input
                        type="radio"
                        id={`product-type-${category.slug}`}
                        name="productType"
                        checked={checked}
                        disabled={freeTextMode}
                        onChange={() => {
                          field.onChange(category.slug)
                        }}
                        className="size-4 accent-[#2F5D50]"
                      />
                      <span className="min-w-0">
                        <span
                          className={`block text-sm text-[#1C1C1C] ${
                            checked ? 'font-semibold' : 'font-normal'
                          }`}
                        >
                          {category.nameZh}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {category.name}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )
          }}
        />

        <div className="border-t border-[#E5E0D8] pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={freeTextMode}
              aria-labelledby="product-type-free-text-label"
              onClick={() => {
                if (!freeTextMode) {
                  setValue('productType', '')
                }
                setFreeTextMode((current) => !current)
              }}
              className={`relative h-6 w-11 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F5D50]/30 ${
                freeTextMode
                  ? 'border-[#2F5D50] bg-[#F0F5F3]'
                  : 'border-[#E5E0D8] bg-white'
              }`}
            >
              <span
                className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all ${
                  freeTextMode
                    ? 'left-6 bg-[#2F5D50]'
                    : 'left-1 bg-[#E5E0D8]'
                }`}
              />
            </button>
            <span id="product-type-free-text-label" className="text-sm font-medium">
              {t('productTypesFreeTextToggle')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('productTypesFreeTextToggleHint')}
            </span>
          </div>
        </div>

        {freeTextMode && (
          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <label
                htmlFor="product-type-note"
                className="text-sm font-semibold text-foreground"
              >
                {t('productTypeNoteLabel')}
              </label>
              <span className="text-xs text-muted-foreground">
                {t('productTypeNoteHint')}
              </span>
            </div>
            <Input
              id="product-type-note"
              maxLength={6}
              placeholder={t('productTypeNotePlaceholder')}
              className="h-11 w-48 rounded-lg border-border bg-white text-sm text-foreground focus-visible:border-muted-foreground focus-visible:ring-[#C4693B]"
              {...register('productTypeNote')}
            />
          </div>
        )}

        {errors.productType && (
          <p className="text-xs text-red-600">
            {errors.productType.message}
          </p>
        )}
      </fieldset>

      {/* Value Tags */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label className="block text-sm font-semibold text-foreground">
            {t('valueTags')}
          </label>
          <Controller
            name="valueTags"
            control={control}
            render={({ field }) => {
              const count = field.value?.length ?? 0

              return (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    count > 0
                      ? 'bg-[#2F5D50] text-white'
                      : 'bg-[#E5E0D8] text-foreground'
                  }`}
                >
                  {count} / 3
                </span>
              )
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('valueTagsHint')}
        </p>
        <Controller
          name="valueTags"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <div className="flex flex-col gap-0.5">
                {valueTags.map((tag) => {
                  const selectedValues = field.value ?? []
                  const checked = selectedValues.includes(tag.slug)
                  const disabled = selectedValues.length >= 3 && !checked

                  return (
                    <label
                      key={tag.id}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground ${
                        disabled ? 'pointer-events-none opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            if (selectedValues.length >= 3) return
                            field.onChange([...selectedValues, tag.slug])
                            return
                          }

                          field.onChange(
                            selectedValues.filter((value) => value !== tag.slug)
                          )
                        }}
                        className="h-4 w-4 rounded border-border text-[#2F5D50] focus:ring-[#2F5D50]"
                      />
                      <span>
                        {tag.nameZh} ({tag.name})
                      </span>
                    </label>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(field.value ?? []).map((slug: string) => {
                  const tag = valueTags.find((valueTag) => valueTag.slug === slug)
                  const label = tag ? `${tag.nameZh} (${tag.name})` : slug

                  return (
                    <span
                      key={slug}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs text-foreground"
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => {
                          field.onChange(
                            (field.value ?? []).filter((value) => value !== slug)
                          )
                        }}
                        className="ml-0.5 text-muted-foreground hover:text-foreground"
                        aria-label={t('removeValue', { value: label })}
                      >
                        &times;
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        />
        {errors.valueTags && (
          <p className="text-xs text-red-600">{errors.valueTags.message}</p>
        )}
      </div>
    </div>
  )
}
