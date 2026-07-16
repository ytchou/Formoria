'use client'

import { useState, useTransition } from 'react'
import { MapPin, Search, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Controller, useFieldArray } from 'react-hook-form'
import { FormField } from '@/components/forms/form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { searchLocationAction } from '@/lib/actions/location-search'
import type { LocationSearchResult } from '@/lib/services/location-search'
import type {
  RetailLocationRelationshipType,
  RetailLocationType,
} from '@/lib/types'
import { useSubmissionWizard } from '../submission-wizard-context'

const RELATIONSHIP_OPTIONS: Array<{
  value: RetailLocationRelationshipType
  labelKey:
    | 'locationTypeBrandStore'
    | 'locationTypeStockist'
    | 'locationTypeDepartmentCounter'
}> = [
  { value: 'brand_store', labelKey: 'locationTypeBrandStore' },
  { value: 'stockist', labelKey: 'locationTypeStockist' },
  {
    value: 'department_counter',
    labelKey: 'locationTypeDepartmentCounter',
  },
]

const LOCATION_TYPE_OPTIONS: Array<{
  value: RetailLocationType | 'unclassified'
  labelKey:
    | 'locationNetworkChain'
    | 'locationNetworkIndependent'
    | 'locationNetworkUnclassified'
}> = [
  { value: 'unclassified', labelKey: 'locationNetworkUnclassified' },
  { value: 'independent', labelKey: 'locationNetworkIndependent' },
  { value: 'chain', labelKey: 'locationNetworkChain' },
]

const EMPTY_LOCATION = {
  name: '',
  relationshipType: 'stockist' as const,
  type: undefined,
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

export function LocationsSection() {
  const locale = useLocale()
  const t = useTranslations('submit')
  const tDashboard = useTranslations('dashboard.edit')
  const { form } = useSubmissionWizard()
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'retailLocations',
  })
  const [searchResults, setSearchResults] = useState<
    Record<string, LocationSearchResult[]>
  >({})
  const [searchErrors, setSearchErrors] = useState<Record<string, string>>({})
  const [searchNotices, setSearchNotices] = useState<Record<string, string>>(
    {},
  )
  const [isSearching, startSearch] = useTransition()

  const searchLocation = (fieldKey: string, index: number) => {
    const query = form.getValues(`retailLocations.${index}.address`)?.trim()
    setSearchNotices((previous) => {
      const next = { ...previous }
      delete next[fieldKey]
      return next
    })

    if (!query) {
      form.setError(`retailLocations.${index}.address`, {
        type: 'required',
        message: t('validation.addressRequired'),
      })
      return
    }

    startSearch(async () => {
      const result = await searchLocationAction(query, locale)
      if (!result.success) {
        setSearchErrors((previous) => ({
          ...previous,
          [fieldKey]: tDashboard('locationSearchError'),
        }))
        return
      }

      setSearchResults((previous) => ({
        ...previous,
        [fieldKey]: result.results,
      }))
      setSearchErrors((previous) => {
        const next = { ...previous }
        delete next[fieldKey]
        return next
      })
      setSearchNotices((previous) => {
        const next = { ...previous }
        if (result.results.length === 0) {
          next[fieldKey] = tDashboard('locationSearchNoResults')
        } else {
          delete next[fieldKey]
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
    setSearchNotices((previous) => {
      const next = { ...previous }
      delete next[fieldKey]
      return next
    })
    setSearchResults((previous) => {
      const next = { ...previous }
      delete next[fieldKey]
      return next
    })
  }

  return (
    <StandardFormSection id="submission-locations">
      <StandardFormStack>
        <div>
          <h2 className="type-section-title">
            {t('submissionWizard.locationsHeading')}
          </h2>
          <p className="mt-1 type-form-hint">
            {t('fields.retailLocationsHint')}
          </p>
        </div>

        {fields.map((field, index) => {
          const fieldId = `submission-retail-location-${index}`
          const locationErrors = form.formState.errors.retailLocations
          const addressError = Array.isArray(locationErrors)
            ? locationErrors.at(index)?.address
            : undefined
          const addressErrorText =
            addressError?.message === 'Duplicate retail location'
              ? tDashboard('locationDuplicateError')
              : addressError
                ? t('validation.addressRequired')
                : undefined
          const addressRegistration = form.register(
            `retailLocations.${index}.address`,
          )
          const results = searchResults[field.id] ?? []

          return (
            <div
              key={field.id}
              className="space-y-4 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 type-subsection-title">
                  {tDashboard('retailLocationItem', { number: index + 1 })}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-12"
                  aria-label={tDashboard('removeItem')}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id={`${fieldId}-relationship-type`}
                  label={tDashboard('fieldLocationType')}
                >
                  <Controller
                    control={form.control}
                    name={`retailLocations.${index}.relationshipType`}
                    render={({ field: relationshipField }) => (
                      <NativeSelect
                        id={`${fieldId}-relationship-type`}
                        value={relationshipField.value ?? 'stockist'}
                        onChange={(event) =>
                          relationshipField.onChange(event.target.value)
                        }
                      >
                        {RELATIONSHIP_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {tDashboard(option.labelKey)}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  />
                </FormField>

                <FormField
                  id={`${fieldId}-network-type`}
                  label={tDashboard('fieldLocationNetwork')}
                >
                  <Controller
                    control={form.control}
                    name={`retailLocations.${index}.type`}
                    render={({ field: networkField }) => (
                      <NativeSelect
                        id={`${fieldId}-network-type`}
                        value={networkField.value ?? 'unclassified'}
                        onChange={(event) =>
                          networkField.onChange(
                            event.target.value === 'unclassified'
                              ? undefined
                              : event.target.value,
                          )
                        }
                      >
                        {LOCATION_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {tDashboard(option.labelKey)}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  />
                </FormField>
              </div>

              <FormField
                id={`${fieldId}-address`}
                label={tDashboard('fieldLocationSearch')}
                error={addressErrorText}
                required
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id={`${fieldId}-address`}
                    placeholder={tDashboard('fieldLocationSearchPlaceholder')}
                    {...addressRegistration}
                    onChange={(event) => {
                      addressRegistration.onChange(event)
                      const value = event.target.value
                      form.setValue(`retailLocations.${index}.name`, value, {
                        shouldDirty: true,
                      })
                      form.setValue(
                        `retailLocations.${index}.venueName`,
                        '',
                        { shouldDirty: true },
                      )
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
                      form.clearErrors(`retailLocations.${index}.address`)
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-12"
                    disabled={isSearching}
                    onClick={() => searchLocation(field.id, index)}
                  >
                    <Search className="size-4" />
                    {tDashboard('searchLocation')}
                  </Button>
                </div>

                {searchErrors[field.id] ? (
                  <p className="type-error" aria-live="polite">
                    {searchErrors[field.id]}
                  </p>
                ) : null}
                {searchNotices[field.id] ? (
                  <p className="type-form-hint" aria-live="polite">
                    {searchNotices[field.id]}
                  </p>
                ) : null}
                {results.length > 0 ? (
                  <div className="overflow-hidden rounded-lg border border-border bg-popover">
                    {results.map((result) => (
                      <Button
                        key={result.id}
                        type="button"
                        variant="ghost"
                        className="h-auto min-h-12 w-full justify-start rounded-none border-b border-border px-3 py-2 text-left text-sm last:border-b-0"
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
                      </Button>
                    ))}
                  </div>
                ) : null}
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id={`${fieldId}-floor-or-counter`}
                  label={tDashboard('fieldFloorOrCounter')}
                >
                  <Input
                    id={`${fieldId}-floor-or-counter`}
                    placeholder={tDashboard('fieldFloorOrCounterPlaceholder')}
                    {...form.register(
                      `retailLocations.${index}.floorOrCounter`,
                    )}
                  />
                </FormField>

                <FormField
                  id={`${fieldId}-availability-note`}
                  label={tDashboard('fieldAvailabilityNote')}
                >
                  <Textarea
                    id={`${fieldId}-availability-note`}
                    placeholder={tDashboard(
                      'fieldAvailabilityNotePlaceholder',
                    )}
                    {...form.register(
                      `retailLocations.${index}.availabilityNote`,
                    )}
                  />
                </FormField>
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
          <MapPin className="size-4" />
          {t('submissionWizard.addLocation')}
        </Button>
      </StandardFormStack>
    </StandardFormSection>
  )
}
