'use client'

import { useFormContext, Controller } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { X, Plus, Star, Globe, Upload } from 'lucide-react'
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
import type { SubmissionFormData } from '@/lib/validations/submission'
import type { PhotoItem } from '@/lib/types/scraper'
import type { TaxonomyTag } from '@/lib/types/taxonomy'

type Category = {
  slug: string
  label?: string
  name?: string
  labelZh?: string
  nameZh?: string | null
}

type BrandInfoStepProps = {
  categories: Category[]
  regionTags: TaxonomyTag[]
  valueTags: TaxonomyTag[]
  uploadPath: string
  photos?: PhotoItem[]
  onPhotosChange?: (photos: PhotoItem[]) => void
  isOwner?: boolean
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
  categories,
  regionTags,
  valueTags,
  uploadPath,
  photos,
  onPhotosChange,
  isOwner = false,
}: BrandInfoStepProps) {
  const t = useTranslations('submit.fields')
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext<SubmissionFormData>()

  const description = watch('description') ?? ''

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
          {...register('name')}
        />
        {errors.name && (
          <p className="text-xs text-red-600">{errors.name.message}</p>
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
          maxLength={2000}
          placeholder={t('brandDescriptionPlaceholder')}
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
          {...register('description')}
        />
        <p className="text-xs text-muted-foreground">
          {t('brandDescriptionHint')}
        </p>
        <div className="flex justify-between">
          {errors.description ? (
            <p className="text-xs text-red-600">{errors.description.message}</p>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">
            {t('charCount', { count: description.length, max: 2000 })}
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

      {/* Category */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-category"
          className="block text-sm font-semibold text-foreground"
        >
          {t('category')}
        </label>
        <select
          id="brand-category"
          className="h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
          {...register('category')}
        >
          <option value="">{t('categoryPlaceholder')}</option>
          {categories.map((cat) => (
            <option key={cat.slug} value={cat.slug}>
              {cat.label ?? cat.name}
              {(cat.labelZh ?? cat.nameZh) ? ` (${cat.labelZh ?? cat.nameZh})` : ''}
            </option>
          ))}
        </select>
        {errors.category && (
          <p className="text-xs text-red-600">{errors.category.message}</p>
        )}
      </div>

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
                      aria-label={t('removeTag', { tag: label })}
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

      {/* Brand Logo */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">
          {isOwner ? t('logoRequired') : t('logoOptional')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('logoHint')}
        </p>
        <Controller
          name="logoUrl"
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
        {errors.logoUrl && (
          <p className="text-xs text-red-600">{errors.logoUrl.message}</p>
        )}
      </div>

    </div>
  )
}
