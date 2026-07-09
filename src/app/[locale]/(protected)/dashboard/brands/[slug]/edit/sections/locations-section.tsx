'use client'

import { useState, useTransition } from 'react'
import { Controller, type UseFormReturn, useFieldArray } from 'react-hook-form'
import { MapPin, Search, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { DashboardFormField } from './dashboard-form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { searchLocationAction } from '@/lib/actions/location-search'
import type { BrandEditFormValues } from '@/lib/schemas/brand-edit'
import type { LocationSearchResult } from '@/lib/services/location-search'
import type { RetailLocationRelationshipType } from '@/lib/types'

const RELATIONSHIP_OPTIONS: Array<{
  value: RetailLocationRelationshipType
  labelKey: string
}> = [
  { value: 'brand_store', labelKey: 'locationTypeBrandStore' },
  { value: 'stockist', labelKey: 'locationTypeStockist' },
  { value: 'department_counter', labelKey: 'locationTypeDepartmentCounter' },
]

const EMPTY_LOCATION = {
  name: '',
  relationshipType: 'stockist' as const,
  address: '',
  city: '',
  district: '',
  venueName: '',
  floorOrCounter: '',
  availabilityNote: '',
  latitude: undefined,
  longitude: undefined,
  verificationStatus: 'manual' as const,
}

export function LocationsSection({
  form,
}: {
  form: UseFormReturn<BrandEditFormValues>
}) {
  const locale = useLocale()
  const t = useTranslations('dashboard.edit')
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'retailLocations',
  })
  const [searchResults, setSearchResults] = useState<
    Record<string, LocationSearchResult[]>
  >({})
  const [searchErrors, setSearchErrors] = useState<Record<string, string>>({})
  const [searchNotices, setSearchNotices] = useState<Record<string, string>>({})
  const [isSearching, startSearch] = useTransition()

  const searchLocation = (fieldKey: string, index: number) => {
    const query = form.getValues(`retailLocations.${index}.address`)?.trim()
    setSearchNotices((prev) => {
      const next = { ...prev }
      delete next[fieldKey]
      return next
    })
    if (!query) {
      form.setError(`retailLocations.${index}.address`, {
        type: 'required',
        message: t('requiredFieldError'),
      })
      return
    }

    startSearch(async () => {
      const result = await searchLocationAction(query, locale)
      if (!result.success) {
        setSearchErrors((prev) => ({
          ...(prev ?? {}),
          [fieldKey]: t('locationSearchError'),
        }))
        return
      }
      setSearchResults((prev) => ({ ...(prev ?? {}), [fieldKey]: result.results }))
      setSearchErrors((prev) => {
        const next = { ...(prev ?? {}) }
        delete next[fieldKey]
        return next
      })
      setSearchNotices((prev) => {
        const next = { ...(prev ?? {}) }
        delete next[fieldKey]
        if (result.results.length === 0) {
          next[fieldKey] = t('locationSearchNoResults')
        }
        return next
      })
    })
  }

  const applySearchResult = (
    fieldKey: string,
    index: number,
    result: LocationSearchResult,
  ) => {
    form.setValue(`retailLocations.${index}.name`, result.name, {
      shouldDirty: true,
    })
    form.setValue(`retailLocations.${index}.venueName`, result.name, {
      shouldDirty: true,
    })
    form.setValue(`retailLocations.${index}.address`, result.address, {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.setValue(`retailLocations.${index}.latitude`, result.latitude, {
      shouldDirty: true,
    })
    form.setValue(`retailLocations.${index}.longitude`, result.longitude, {
      shouldDirty: true,
    })
    form.setValue(`retailLocations.${index}.verificationStatus`, 'verified', {
      shouldDirty: true,
    })
    form.clearErrors(`retailLocations.${index}.address`)
    setSearchNotices((prev) => {
      const next = { ...prev }
      delete next[fieldKey]
      return next
    })
    setSearchResults((prev) => {
      const next = { ...prev }
      delete next[fieldKey]
      return next
    })
  }

  return (
    <StandardFormSection id="locations">
      <StandardFormStack>
        <h2 className="type-section-title">
          {t('sectionLocations')}
        </h2>
        <p className="mt-1 type-form-hint">
          {t('sectionLocationsHelp')}
        </p>

        {fields.map((field, index) => {
          const fieldId = `retailLocations-${index}`
          const formAddressErrors = form.formState.errors.retailLocations
          const addressError = Array.isArray(formAddressErrors)
            ? formAddressErrors.at(index)?.address
            : undefined
          const addressErrorText =
            addressError?.message === 'Duplicate retail location'
              ? t('locationDuplicateError')
              : (addressError?.message ??
                (addressError ? t('requiredFieldError') : undefined))
          const addressRegistration = form.register(
            `retailLocations.${index}.address`,
          )
          const safeSearchResults = searchResults ?? {}
          const safeSearchErrors = searchErrors ?? {}
          const safeSearchNotices = searchNotices ?? {}
          const results = safeSearchResults[field.id] ?? []

          return (
            <div
              key={field.id}
              className="space-y-4 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 type-subsection-title">
                  {t('retailLocationItem', { number: index + 1 })}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('removeItem')}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                <DashboardFormField
                  id={`${fieldId}-relationshipType`}
                  label={t('fieldLocationType')}
                  className="px-0 py-0"
                >
                  <Controller
                    control={form.control}
                    name={`retailLocations.${index}.relationshipType`}
                    render={({ field }) => (
                      <Select
                        value={field.value ?? 'stockist'}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger
                          id={`${fieldId}-relationshipType`}
                          className="min-h-12 w-full bg-card"
                        >
                          <SelectValue>
                            {(value) =>
                              t(
                                RELATIONSHIP_OPTIONS.find(
                                  (option) => option.value === value,
                                )?.labelKey ?? 'locationTypeStockist',
                              )
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {RELATIONSHIP_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </DashboardFormField>

                <DashboardFormField
                  id={`${fieldId}-address`}
                  label={t('fieldLocationSearch')}
                  required
                  error={addressErrorText}
                  errorId={`${fieldId}-address-error`}
                  className="px-0 py-0"
                >
                  <div className="flex gap-2">
                    <Input
                      id={`${fieldId}-address`}
                      className="min-h-12 bg-card"
                      placeholder={t('fieldLocationSearchPlaceholder')}
                      aria-required="true"
                      aria-invalid={Boolean(addressErrorText)}
                      aria-describedby={
                        addressErrorText
                          ? `${fieldId}-address-error`
                          : undefined
                      }
                      {...addressRegistration}
                      onChange={(event) => {
                        addressRegistration.onChange(event)
                        const value = String(event.target.value ?? '')
                        form.setValue(`retailLocations.${index}.name`, value, {
                          shouldDirty: true,
                        })
                        form.setValue(
                          `retailLocations.${index}.venueName`,
                          '',
                          {
                            shouldDirty: true,
                          },
                        )
                        form.clearErrors(`retailLocations.${index}.address`)
                        form.setValue(
                          `retailLocations.${index}.latitude`,
                          undefined,
                          { shouldDirty: true },
                        )
                        form.setValue(
                          `retailLocations.${index}.longitude`,
                          undefined,
                          { shouldDirty: true },
                        )
                        form.setValue(
                          `retailLocations.${index}.verificationStatus`,
                          'manual',
                          { shouldDirty: true },
                        )
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-12"
                      disabled={isSearching}
                      onClick={() => searchLocation(field.id, index)}
                    >
                      <Search className="h-4 w-4" />
                      {t('searchLocation')}
                    </Button>
                  </div>
                  {safeSearchErrors[field.id] ? (
                    <p className="type-error" aria-live="polite">
                      {safeSearchErrors[field.id]}
                    </p>
                  ) : null}
                  {safeSearchNotices[field.id] ? (
                    <p className="type-form-hint" aria-live="polite">
                      {safeSearchNotices[field.id]}
                    </p>
                  ) : null}
                  {results.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-border bg-popover">
                      {results.map((result) => (
                        <button
                          key={result.id}
                          type="button"
                          className="block min-h-12 w-full border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                          onClick={() =>
                            applySearchResult(field.id, index, result)
                          }
                        >
                          <span className="block type-body-emphasis">
                            {result.name}
                          </span>
                          <span className="block type-form-hint">
                            {result.address}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </DashboardFormField>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <DashboardFormField
                  id={`${fieldId}-floorOrCounter`}
                  label={t('fieldFloorOrCounter')}
                  className="px-0 py-0"
                >
                  <Input
                    id={`${fieldId}-floorOrCounter`}
                    className="min-h-12 bg-card"
                    placeholder={t('fieldFloorOrCounterPlaceholder')}
                    {...form.register(
                      `retailLocations.${index}.floorOrCounter`,
                    )}
                  />
                </DashboardFormField>

                <DashboardFormField
                  id={`${fieldId}-availabilityNote`}
                  label={t('fieldAvailabilityNote')}
                  className="px-0 py-0"
                >
                  <Textarea
                    id={`${fieldId}-availabilityNote`}
                    className="min-h-12 bg-card"
                    placeholder={t('fieldAvailabilityNotePlaceholder')}
                    {...form.register(
                      `retailLocations.${index}.availabilityNote`,
                    )}
                  />
                </DashboardFormField>
              </div>

              <input
                type="hidden"
                {...form.register(`retailLocations.${index}.name`)}
              />
              <input
                type="hidden"
                {...form.register(`retailLocations.${index}.venueName`)}
              />
              <input
                type="hidden"
                {...form.register(`retailLocations.${index}.latitude`)}
              />
              <input
                type="hidden"
                {...form.register(`retailLocations.${index}.longitude`)}
              />
              <input
                type="hidden"
                {...form.register(
                  `retailLocations.${index}.verificationStatus`,
                )}
              />
            </div>
          )
        })}

        <Button
          type="button"
          variant="secondary"
          onClick={() => append(EMPTY_LOCATION)}
        >
          <MapPin className="h-4 w-4" />
          {t('addRetailLocation')}
        </Button>
      </StandardFormStack>
    </StandardFormSection>
  )
}
