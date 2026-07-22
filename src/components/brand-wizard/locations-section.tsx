'use client'

import { useState, useTransition } from 'react'
import {
  Controller,
  useFieldArray,
  useFormContext,
  useWatch,
} from 'react-hook-form'
import { MapPin, Search, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { DashboardFormField } from './dashboard-form-field'
import {
  StandardFormSection,
  StandardFormStack,
} from '@/components/forms/form-layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { searchLocationAction } from '@/lib/actions/location-search'
import type { BrandWizardCommonValues } from '@/lib/schemas/brand-wizard'
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

const INFORMATION_KIND_OPTIONS = [
  { value: 'location' as const, labelKey: 'informationKindLocation' },
  { value: 'retail_chain' as const, labelKey: 'informationKindRetailChain' },
]

const EMPTY_LOCATION = {
  kind: 'location' as const,
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
  confirmationStatus: 'unconfirmed' as const,
}

const EMPTY_RETAIL_CHAIN = {
  kind: 'retail_chain' as const,
  name: '',
  retailerUrl: '',
  availabilityNote: '',
}

type BrandLocationsSectionProps = {
  isActualOwner?: boolean
}

export function BrandLocationsSection({
  isActualOwner = false,
}: BrandLocationsSectionProps) {
  const form = useFormContext<BrandWizardCommonValues>()
  const locale = useLocale()
  const t = useTranslations('dashboard.edit')
  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: 'retailLocations',
  })
  const watchedLocations = useWatch({
    control: form.control,
    name: 'retailLocations',
  })
  const [searchResults, setSearchResults] = useState<
    Record<string, LocationSearchResult[]>
  >({})
  const [searchErrors, setSearchErrors] = useState<Record<string, string>>({})
  const [searchNotices, setSearchNotices] = useState<Record<string, string>>({})
  const [isSearching, startSearch] = useTransition()

  const clearSearchFeedback = (fieldKey: string) => {
    setSearchResults((previous) => {
      const next = { ...previous }
      delete next[fieldKey]
      return next
    })
    setSearchErrors((previous) => {
      const next = { ...previous }
      delete next[fieldKey]
      return next
    })
    setSearchNotices((previous) => {
      const next = { ...previous }
      delete next[fieldKey]
      return next
    })
  }

  const resetConfirmation = (index: number) => {
    form.setValue(
      `retailLocations.${index}.confirmationStatus`,
      'unconfirmed',
      { shouldDirty: true },
    )
  }

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
        message: t('requiredFieldError'),
      })
      return
    }

    startSearch(async () => {
      const result = await searchLocationAction(query, locale)
      if (!result.success) {
        setSearchErrors((previous) => ({
          ...previous,
          [fieldKey]: t('locationSearchError'),
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
    resetConfirmation(index)
    form.clearErrors(`retailLocations.${index}.address`)
    clearSearchFeedback(fieldKey)
  }

  const getErrorText = (message: unknown) => {
    if (message === 'Duplicate retail location') {
      return t('locationDuplicateError')
    }
    if (message === 'Address is required for owner confirmation') {
      return t('ownerConfirmationAddressError')
    }
    if (message === 'Retailer URL must use HTTP(S)') {
      return t('retailerUrlError')
    }
    return typeof message === 'string' ? message : undefined
  }

  return (
    <StandardFormSection id="locations">
      <StandardFormStack>
        <h2 className="type-section-title">{t('sectionLocations')}</h2>
        <p className="mt-1 type-form-hint">{t('sectionLocationsHelp')}</p>

        {fields.map((field, index) => {
          const fieldId = `retailLocations-${index}`
          const currentLocation = watchedLocations?.at(index)
          const informationKind =
            currentLocation?.kind === 'retail_chain'
              ? 'retail_chain'
              : 'location'
          const formErrors = form.formState.errors.retailLocations
          const fieldErrors = Array.isArray(formErrors)
            ? formErrors.at(index)
            : undefined
          const nameErrorText = getErrorText(fieldErrors?.name?.message)
          const addressErrorText = getErrorText(fieldErrors?.address?.message)
          const retailerUrlErrorText = getErrorText(
            fieldErrors?.retailerUrl?.message,
          )
          const results = searchResults[field.id] ?? []

          const changeInformationKind = (
            nextKind: 'location' | 'retail_chain',
          ) => {
            if (nextKind === informationKind) return
            const replacement =
              nextKind === 'location'
                ? { ...EMPTY_LOCATION }
                : { ...EMPTY_RETAIL_CHAIN }
            update(index, replacement)
            queueMicrotask(() => {
              form.unregister(`retailLocations.${index}`)
              form.setValue(`retailLocations.${index}`, replacement, {
                shouldDirty: true,
              })
            })
            form.clearErrors(`retailLocations.${index}`)
            clearSearchFeedback(field.id)
          }

          const nameRegistration = form.register(
            `retailLocations.${index}.name`,
            informationKind === 'location'
              ? { onChange: () => resetConfirmation(index) }
              : undefined,
          )

          return (
            <div
              key={field.id}
              className="space-y-5 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 type-subsection-title">
                  {t('retailLocationItem', { number: index + 1 })}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-12"
                  aria-label={t('removeItem')}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <DashboardFormField
                id={`${fieldId}-kind`}
                label={t('fieldInformationKind')}
                className="px-0 py-0 sm:max-w-md"
              >
                <Select
                  value={informationKind}
                  onValueChange={(value) =>
                    changeInformationKind(
                      value as 'location' | 'retail_chain',
                    )
                  }
                >
                  <SelectTrigger
                    id={`${fieldId}-kind`}
                    className="min-h-12 w-full bg-card"
                  >
                    <SelectValue>
                      {(value) =>
                        t(
                          INFORMATION_KIND_OPTIONS.find(
                            (option) => option.value === value,
                          )?.labelKey ?? 'informationKindLocation',
                        )
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {INFORMATION_KIND_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </DashboardFormField>

              {informationKind === 'retail_chain' ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DashboardFormField
                      id={`${fieldId}-name`}
                      label={t('fieldRetailChainName')}
                      error={nameErrorText}
                      errorId={`${fieldId}-name-error`}
                      className="px-0 py-0"
                    >
                      <Input
                        id={`${fieldId}-name`}
                        className="min-h-12 bg-card"
                        placeholder={t('fieldRetailChainNamePlaceholder')}
                        aria-invalid={Boolean(nameErrorText)}
                        aria-describedby={
                          nameErrorText ? `${fieldId}-name-error` : undefined
                        }
                        {...nameRegistration}
                      />
                    </DashboardFormField>

                    <DashboardFormField
                      id={`${fieldId}-retailerUrl`}
                      label={t('fieldRetailerUrl')}
                      error={retailerUrlErrorText}
                      errorId={`${fieldId}-retailerUrl-error`}
                      className="px-0 py-0"
                    >
                      <Input
                        id={`${fieldId}-retailerUrl`}
                        type="url"
                        className="min-h-12 bg-card"
                        placeholder={t('fieldRetailerUrlPlaceholder')}
                        aria-invalid={Boolean(retailerUrlErrorText)}
                        aria-describedby={
                          retailerUrlErrorText
                            ? `${fieldId}-retailerUrl-error`
                            : undefined
                        }
                        {...form.register(
                          `retailLocations.${index}.retailerUrl`,
                        )}
                      />
                    </DashboardFormField>
                  </div>

                  <DashboardFormField
                    id={`${fieldId}-availabilityNote`}
                    label={t('fieldAvailabilityNote')}
                    className="px-0 py-0"
                  >
                    <Textarea
                      id={`${fieldId}-availabilityNote`}
                      className="min-h-24 bg-card"
                      placeholder={t('fieldAvailabilityNotePlaceholder')}
                      {...form.register(
                        `retailLocations.${index}.availabilityNote`,
                      )}
                    />
                  </DashboardFormField>
                </>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DashboardFormField
                      id={`${fieldId}-name`}
                      label={t('fieldLocationName')}
                      error={nameErrorText}
                      errorId={`${fieldId}-name-error`}
                      className="px-0 py-0"
                    >
                      <Input
                        id={`${fieldId}-name`}
                        className="min-h-12 bg-card"
                        placeholder={t('fieldLocationNamePlaceholder')}
                        aria-invalid={Boolean(nameErrorText)}
                        aria-describedby={
                          nameErrorText ? `${fieldId}-name-error` : undefined
                        }
                        {...nameRegistration}
                      />
                    </DashboardFormField>

                    <DashboardFormField
                      id={`${fieldId}-relationshipType`}
                      label={t('fieldLocationType')}
                      className="px-0 py-0"
                    >
                      <Controller
                        control={form.control}
                        name={`retailLocations.${index}.relationshipType`}
                        render={({ field: relationshipField }) => (
                          <Select
                            value={relationshipField.value ?? 'stockist'}
                            onValueChange={(value) => {
                              relationshipField.onChange(value)
                              resetConfirmation(index)
                            }}
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
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {t(option.labelKey)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </DashboardFormField>
                  </div>

                  <DashboardFormField
                    id={`${fieldId}-address`}
                    label={t('fieldLocationSearch')}
                    error={addressErrorText}
                    errorId={`${fieldId}-address-error`}
                    className="px-0 py-0"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {(() => {
                        const addressRegistration = form.register(
                          `retailLocations.${index}.address`,
                          {
                            onChange: () => {
                              form.clearErrors(
                                `retailLocations.${index}.address`,
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
                              resetConfirmation(index)
                            },
                          },
                        )
                        return (
                          <Input
                            id={`${fieldId}-address`}
                            className="min-h-12 bg-card"
                            placeholder={t('fieldLocationSearchPlaceholder')}
                            aria-invalid={Boolean(addressErrorText)}
                            aria-describedby={
                              addressErrorText
                                ? `${fieldId}-address-error`
                                : undefined
                            }
                            {...addressRegistration}
                          />
                        )
                      })()}
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-12 shrink-0"
                        disabled={isSearching}
                        onClick={() => searchLocation(field.id, index)}
                      >
                        <Search className="h-4 w-4" />
                        {t('searchLocation')}
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
                  </DashboardFormField>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <DashboardFormField
                      id={`${fieldId}-venueName`}
                      label={t('fieldVenueName')}
                      className="px-0 py-0"
                    >
                      {(() => {
                        const venueRegistration = form.register(
                          `retailLocations.${index}.venueName`,
                          { onChange: () => resetConfirmation(index) },
                        )
                        return (
                          <Input
                            id={`${fieldId}-venueName`}
                            className="min-h-12 bg-card"
                            placeholder={t('fieldVenueNamePlaceholder')}
                            {...venueRegistration}
                          />
                        )
                      })()}
                    </DashboardFormField>

                    <DashboardFormField
                      id={`${fieldId}-floorOrCounter`}
                      label={t('fieldFloorOrCounter')}
                      className="px-0 py-0"
                    >
                      {(() => {
                        const floorRegistration = form.register(
                          `retailLocations.${index}.floorOrCounter`,
                          { onChange: () => resetConfirmation(index) },
                        )
                        return (
                          <Input
                            id={`${fieldId}-floorOrCounter`}
                            className="min-h-12 bg-card"
                            placeholder={t('fieldFloorOrCounterPlaceholder')}
                            {...floorRegistration}
                          />
                        )
                      })()}
                    </DashboardFormField>
                  </div>

                  <DashboardFormField
                    id={`${fieldId}-availabilityNote`}
                    label={t('fieldAvailabilityNote')}
                    className="px-0 py-0"
                  >
                    <Textarea
                      id={`${fieldId}-availabilityNote`}
                      className="min-h-24 bg-card"
                      placeholder={t('fieldAvailabilityNotePlaceholder')}
                      {...form.register(
                        `retailLocations.${index}.availabilityNote`,
                      )}
                    />
                  </DashboardFormField>

                  {isActualOwner ? (
                    <div className="space-y-1">
                      <Label
                        htmlFor={`${fieldId}-ownerConfirmed`}
                        className="flex min-h-12 cursor-pointer items-center gap-3"
                      >
                        <Checkbox
                          id={`${fieldId}-ownerConfirmed`}
                          checked={
                            currentLocation?.confirmationStatus ===
                            'owner_confirmed'
                          }
                          onCheckedChange={(checked) =>
                            form.setValue(
                              `retailLocations.${index}.confirmationStatus`,
                              checked ? 'owner_confirmed' : 'unconfirmed',
                              { shouldDirty: true },
                            )
                          }
                          aria-describedby={`${fieldId}-ownerConfirmed-help`}
                          className="size-[18px] shrink-0"
                        />
                        <span className="type-body font-normal">
                          {t('ownerConfirmationLabel')}
                        </span>
                      </Label>
                      <p
                        id={`${fieldId}-ownerConfirmed-help`}
                        className="pl-[30px] type-form-hint"
                      >
                        {t('ownerConfirmationHelp')}
                      </p>
                    </div>
                  ) : null}

                  <input
                    type="hidden"
                    {...form.register(
                      `retailLocations.${index}.confirmationStatus`,
                    )}
                  />

                  <input
                    type="hidden"
                    {...form.register(`retailLocations.${index}.city`)}
                  />
                  <input
                    type="hidden"
                    {...form.register(`retailLocations.${index}.district`)}
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
                </>
              )}
            </div>
          )
        })}

        <Button
          type="button"
          variant="secondary"
          className="min-h-12"
          onClick={() => append({ ...EMPTY_LOCATION })}
        >
          <MapPin className="h-4 w-4" />
          {t('addRetailLocation')}
        </Button>
      </StandardFormStack>
    </StandardFormSection>
  )
}
