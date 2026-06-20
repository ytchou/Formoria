'use client'

import { useState } from 'react'
import { useFormContext, Controller, useFieldArray } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { X, Plus, Star, Globe, Upload, ArrowRight, Trash2 } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ImageUploader } from '../upload/ImageUploader'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { checkDuplicates, suggestCleanName } from '@/app/[locale]/submit/actions'
import { Link } from '@/i18n/navigation'
import type { SubmissionFormData } from '@/lib/validations/submission'
import type { PhotoItem } from '@/lib/types/scraper'
import type { TaxonomyTag } from '@/lib/types/taxonomy'
import type { DuplicateCheckResult } from '@/lib/types/submission'

type BrandInfoStepProps = {
  regionTags: TaxonomyTag[]
  uploadPath: string
  photos?: PhotoItem[]
  onPhotosChange?: (photos: PhotoItem[]) => void

  onNext?: (values: SubmissionFormData) => void
}

function Alert({
  variant,
  children,
}: {
  variant?: 'destructive'
  children: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className={`rounded-lg border bg-white p-4 text-sm ${
        variant === 'destructive'
          ? 'border-red-200 text-red-800'
          : 'border-border text-foreground'
      }`}
    >
      {children}
    </div>
  )
}

function AlertTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-semibold">{children}</div>
}

function AlertDescription({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-sm">{children}</div>
}

function SortablePhoto({
  photo,
  isHero,
  onRemove,
  tFromWebsite,
  tUploaded,
}: {
  photo: PhotoItem
  isHero: boolean
  onRemove: () => void
  tFromWebsite: string
  tUploaded: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: photo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-border"
      {...attributes}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt=""
        loading="lazy"
        className="h-full w-full cursor-grab object-cover"
        {...listeners}
      />

      {/* Badges */}
      <div className="absolute left-1.5 top-1.5 flex flex-col gap-1">
        {isHero && (
          <span className="inline-flex items-center gap-1 rounded-full bg-cta px-2 py-0.5 text-[10px] font-medium text-cta-foreground">
            <Star className="h-3 w-3" />
            Hero
          </span>
        )}

        {photo.source === 'scraped' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
            <Globe className="h-3 w-3" />
            {tFromWebsite}
          </span>
        )}
        {photo.source === 'uploaded' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-medium text-white">
            <Upload className="h-3 w-3" />
            {tUploaded}
          </span>
        )}
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="absolute right-1.5 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent/80 text-accent-foreground hover:bg-accent"
        aria-label={`Remove photo ${photo.id}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

function PhotoGallery({
  photos,
  onPhotosChange,
  tNoPhotos,
  tAddPhotos,
  tAddMorePhotos,
  tFromWebsite,
  tUploaded,
}: {
  photos: PhotoItem[]
  onPhotosChange: (photos: PhotoItem[]) => void
  tNoPhotos: string
  tAddPhotos: string
  tAddMorePhotos: string
  tFromWebsite: string
  tUploaded: string
}) {
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = photos.findIndex((p) => p.id === active.id)
    const newIndex = photos.findIndex((p) => p.id === over.id)

    const reordered = [...photos]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    onPhotosChange(reordered)
  }

  const handleRemove = (id: string) => {
    onPhotosChange(photos.filter((p) => p.id !== id))
  }

  if (photos.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {tNoPhotos}
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground/80"
          aria-label={tAddPhotos}
        >
          <Plus className="h-4 w-4" />
          {tAddPhotos}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={photos.map((p) => p.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-4 gap-3">
            {photos.map((photo, index) => (
              <SortablePhoto
                key={photo.id}
                photo={photo}
                isHero={index === 0}
                onRemove={() => handleRemove(photo.id)}
                tFromWebsite={tFromWebsite}
                tUploaded={tUploaded}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {photos.length < 6 && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground/80"
        >
          <Plus className="h-4 w-4" />
          {tAddMorePhotos}
        </button>
      )}
    </div>
  )
}

export function BrandInfoStep({
  regionTags,
  uploadPath,
  photos,
  onPhotosChange,

  onNext,
}: BrandInfoStepProps) {
  const t = useTranslations('submit.fields')
  const {
    register,
    control,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<SubmissionFormData>()
  const { fields: locationFields, append: appendLocation, remove: removeLocation } = useFieldArray({ control, name: 'retailLocations' })

  const description = watch('description') ?? ''
  const name = watch('name') ?? ''
  const unifiedBusinessNumber = watch('unifiedBusinessNumber') ?? ''
  const [dedupResult, setDedupResult] = useState<DuplicateCheckResult | null>(
    null
  )
  const [dedupCheckedName, setDedupCheckedName] = useState('')
  const [dedupCheckedUbn, setDedupCheckedUbn] = useState('')
  const [dedupConfirmed, setDedupConfirmed] = useState(false)
  const [dedupError, setDedupError] = useState<string | null>(null)
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false)
  const [nameSuggestion, setNameSuggestion] = useState<string | null>(null)
  const nameRegistration = register('name')
  const activeDedupResult =
    dedupResult &&
    dedupCheckedName === name &&
    dedupCheckedUbn === unifiedBusinessNumber
      ? dedupResult
      : null

  const handleNext = async () => {
    setDedupError(null)
    if (!onNext || activeDedupResult?.ubnMatch) return

    const formValues = getValues()
    const formUbn = formValues.unifiedBusinessNumber ?? ''
    const hasConfirmedCurrentDuplicate =
      dedupConfirmed &&
      dedupCheckedName === formValues.name &&
      dedupCheckedUbn === formUbn

    setIsCheckingDuplicates(true)
    try {
      const result = await checkDuplicates(
        formValues.name,
        formValues.unifiedBusinessNumber
      )
      setDedupCheckedName(formValues.name)
      setDedupCheckedUbn(formUbn)
      setDedupResult(result)

      if (result.ubnMatch) return
      if (result.nameMatches.length > 0 && !hasConfirmedCurrentDuplicate) {
        setDedupConfirmed(false)
        return
      }

      onNext(formValues)
    } catch (err) {
      console.error("[handleNext] checkDuplicates failed:", err)
      setDedupError(t("dedup_check_failed"))
    } finally {
      setIsCheckingDuplicates(false)
    }
  }

  const handleNameBlur = async () => {
    const currentName = getValues('name')
    if (!currentName || currentName.length < 2) return

    const result = await suggestCleanName(currentName)
    if (result.changed && result.suggestion) {
      setNameSuggestion(result.suggestion)
    } else {
      setNameSuggestion(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Brand Name */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-name"
          className="block text-sm font-semibold text-foreground"
        >
          {t('brandName')}
        </label>
        <input
          id="brand-name"
          type="text"
          placeholder={t('brandNamePlaceholder')}
          className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
          {...nameRegistration}
          onBlur={async (event) => {
            nameRegistration.onBlur(event)
            await handleNameBlur()
          }}
          onChange={(event) => {
            setNameSuggestion(null)
            nameRegistration.onChange(event)
          }}
        />
        {nameSuggestion && (
          <Alert>
            <AlertDescription>
              <div className="flex items-center justify-between gap-3">
                <span>
                  Suggested name: <strong>{nameSuggestion}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setValue('name', nameSuggestion)
                    setNameSuggestion(null)
                  }}
                  className="inline-flex items-center rounded-lg border border-border px-3 py-1 text-xs font-medium hover:bg-secondary"
                >
                  Apply
                </button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {errors.name && (
          <p className="text-xs text-red-600">{errors.name.message}</p>
        )}
      </div>

      {/* Brand Image */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">
          {t('logoOptional')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('logoHint')}
        </p>
        <Controller
          name="heroImageUrl"
          control={control}
          render={({ field }) => (
            <ImageUploader
              mode="single"
              bucket="brand-images"
              path={uploadPath}
              value={field.value}
              onUpload={(url) => field.onChange(url)}
            />
          )}
        />
        {errors.heroImageUrl && (
          <p className="text-xs text-red-600">{errors.heroImageUrl.message}</p>
        )}
      </div>

      {/* Unified Business Number */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-ubn"
          className="block text-sm font-semibold text-foreground"
        >
          {t('ubn')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('ubnHint')}
        </p>
        <Input
          id="brand-ubn"
          placeholder="12345678"
          inputMode="numeric"
          maxLength={8}
          className="h-auto rounded-lg border-border bg-white px-[14px] py-2.5"
          {...register('unifiedBusinessNumber')}
        />
        {errors.unifiedBusinessNumber && (
          <p className="text-xs text-red-600">
            {errors.unifiedBusinessNumber.message}
          </p>
        )}
      </div>

      {/* Brand Description */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-description"
          className="block text-sm font-semibold text-foreground"
        >
          {t('brandDescription')}
        </label>
        <textarea
          id="brand-description"
          rows={4}
          maxLength={500}
          placeholder={t('brandDescriptionPlaceholder')}
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
          {...register('description')}
        />
        <div className="flex justify-between">
          {errors.description ? (
            <p className="text-xs text-red-600">{errors.description.message}</p>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            {t('charCount', { count: description.length, max: 500 })}
          </span>
        </div>
      </div>

      {/* Photo Gallery (from scraping) */}
      {photos && onPhotosChange && (
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">
            {t('photos')}
          </label>
          <p className="text-xs text-muted-foreground">
            {t('photosDragHint')}
          </p>
          <PhotoGallery
            photos={photos}
            onPhotosChange={onPhotosChange}
            tNoPhotos={t('noPhotos')}
            tAddPhotos={t('addPhotos')}
            tAddMorePhotos={t('addMorePhotos')}
            tFromWebsite={t('fromWebsite')}
            tUploaded={t('uploaded')}
          />
        </div>
      )}

      {/* Region */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-region"
          className="block text-sm font-semibold text-foreground"
        >
          {t('region')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('regionHint')}
        </p>
        <select
          id="brand-region"
          className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
          {...register('region')}
        >
          <option value="" disabled>
            {t('regionPlaceholder')}
          </option>
          {regionTags.map((tag) => (
            <option key={tag.id} value={tag.slug}>
              {tag.nameZh} ({tag.name})
            </option>
          ))}
        </select>
        {errors.region && (
          <p className="text-xs text-red-600">{errors.region.message}</p>
        )}
      </div>

      {/* Retail Locations */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('retailLocations')}</h3>
          <p className="text-xs text-muted-foreground">{t('retailLocationsHint')}</p>
        </div>
        {locationFields.length > 0 && (
          <div className="space-y-2">
            {locationFields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <input type="text" placeholder={t('storeName')} className="h-11 w-40 shrink-0 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20" {...register(`retailLocations.${index}.name`)} />
                <input type="text" placeholder={t('address')} className="h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20" {...register(`retailLocations.${index}.address`)} />
                <button type="button" onClick={() => removeLocation(index)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Remove location ${index + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={() => appendLocation({ name: '', address: '' })} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground/80">
          <Plus className="h-4 w-4" />
          {t('addLocation')}
        </button>
      </div>

      {activeDedupResult?.ubnMatch && (
        <Alert variant="destructive">
          <AlertTitle>{t('ubnDuplicateTitle')}</AlertTitle>
          <AlertDescription>
            {t('ubnDuplicateSeeExisting')}
            <Link
              href={`/brands/${activeDedupResult.ubnMatch.slug}`}
              className="ml-1 underline"
            >
              {activeDedupResult.ubnMatch.name}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {activeDedupResult &&
        !activeDedupResult.ubnMatch &&
        activeDedupResult.nameMatches.length > 0 && (
          <Alert>
            <AlertTitle>{t('nameDuplicateTitle')}</AlertTitle>
            <AlertDescription>
              <ul className="mb-2 mt-1 list-inside list-disc">
                {activeDedupResult.nameMatches.map((m) => (
                  <li key={m.id}>
                    {m.name} ({Math.round(m.similarity * 100)}%)
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <Checkbox
                  id="dedup-confirm"
                  checked={dedupConfirmed}
                  onCheckedChange={(checked) => setDedupConfirmed(!!checked)}
                  className="data-[checked]:border-[#2F5D50] data-[checked]:bg-[#2F5D50] focus-visible:ring-[#2F5D50]/40"
                />
                <label
                  htmlFor="dedup-confirm"
                  className="cursor-pointer text-sm"
                >
                  {t('nameDuplicateConfirmLabel')}
                </label>
              </div>
            </AlertDescription>
          </Alert>
        )}

      {onNext && (
        <div className="flex flex-col items-end">
          <button
            type="button"
            onClick={handleNext}
            disabled={isCheckingDuplicates || !!activeDedupResult?.ubnMatch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F5D50] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#2F5D50]/90 disabled:opacity-50"
          >
            {isCheckingDuplicates ? t('checking') : t('next')}
            <ArrowRight className="h-4 w-4" />
          </button>
          {dedupError && (
            <p className="text-sm text-destructive mt-1">{dedupError}</p>
          )}
        </div>
      )}
    </div>
  )
}
