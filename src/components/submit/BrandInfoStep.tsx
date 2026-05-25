'use client'

import { useFormContext, Controller } from 'react-hook-form'
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

type Category = {
  slug: string
  label?: string
  name?: string
  labelZh?: string
  nameZh?: string | null
}

type BrandInfoStepProps = {
  categories: Category[]
  uploadPath: string
  photos?: PhotoItem[]
  onPhotosChange?: (photos: PhotoItem[]) => void
  isOwner?: boolean
}

function SortablePhoto({
  photo,
  isHero,
  onRemove,
}: {
  photo: PhotoItem
  isHero: boolean
  onRemove: () => void
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
      className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-[#E8E5E0]"
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
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E06B3F] px-2 py-0.5 text-[10px] font-medium text-white">
            <Star className="h-3 w-3" />
            Hero
          </span>
        )}

        {photo.source === 'scraped' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#3D3530] px-2 py-0.5 text-[10px] font-medium text-white">
            <Globe className="h-3 w-3" />
            from website
          </span>
        )}
        {photo.source === 'uploaded' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-medium text-white">
            <Upload className="h-3 w-3" />
            uploaded
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
        className="absolute right-1.5 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#3D3530]/80 text-white hover:bg-[#3D3530]"
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
}: {
  photos: PhotoItem[]
  onPhotosChange: (photos: PhotoItem[]) => void
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
        <p className="text-sm text-[#7C7570]">
          No photos found from your website
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8B7355] hover:text-[#6A573F]"
          aria-label="Add photos"
        >
          <Plus className="h-4 w-4" />
          Add photos
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
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {photos.length < 6 && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8B7355] hover:text-[#6A573F]"
        >
          <Plus className="h-4 w-4" />
          Add more photos
        </button>
      )}
    </div>
  )
}

export function BrandInfoStep({
  categories,
  uploadPath,
  photos,
  onPhotosChange,
  isOwner = false,
}: BrandInfoStepProps) {
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
          className="block text-sm font-semibold text-[#1A1918]"
        >
          Brand Name
        </label>
        <input
          id="brand-name"
          type="text"
          placeholder="e.g. 雨靴工作室"
          className="h-11 w-full rounded-lg border border-[#D4CFC9] bg-white px-3 text-sm text-[#1A1918] placeholder:text-[#B0AAA4] focus:border-[#8B7355] focus:outline-none focus:ring-2 focus:ring-[#8B7355]/20"
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
          className="block text-sm font-semibold text-[#1A1918]"
        >
          Brand Description
        </label>
        <textarea
          id="brand-description"
          rows={4}
          placeholder="Tell us about your brand..."
          className="w-full rounded-lg border border-[#D4CFC9] bg-white px-3 py-2 text-sm text-[#1A1918] placeholder:text-[#B0AAA4] focus:border-[#8B7355] focus:outline-none focus:ring-2 focus:ring-[#8B7355]/20"
          {...register('description')}
        />
        <div className="flex justify-between">
          {errors.description ? (
            <p className="text-xs text-red-600">{errors.description.message}</p>
          ) : (
            <span />
          )}
          <span className="text-xs text-[#7C7570]">
            {description.length} / 500 max characters
          </span>
        </div>
      </div>

      {/* Photo Gallery (from scraping) */}
      {photos && onPhotosChange && (
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-[#1A1918]">
            Photos
          </label>
          <p className="text-xs text-[#7C7570]">
            Drag to reorder. The first photo becomes the hero image.
          </p>
          <PhotoGallery photos={photos} onPhotosChange={onPhotosChange} />
        </div>
      )}

      {/* Category */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-category"
          className="block text-sm font-semibold text-[#1A1918]"
        >
          Category
        </label>
        <select
          id="brand-category"
          className="h-11 w-full rounded-lg border border-[#D4CFC9] bg-white px-3 text-sm text-[#1A1918] focus:border-[#8B7355] focus:outline-none focus:ring-2 focus:ring-[#8B7355]/20"
          {...register('category')}
        >
          <option value="">Select a category</option>
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

      {/* Tags */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-[#1A1918]">
          Tags
        </label>
        <p className="text-xs text-[#7C7570]">
          Add up to 5 tags to help people find your brand
        </p>
        <Controller
          name="tags"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(field.value ?? []).map((tag: string, i: number) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-[#F5F4F1] px-3 py-1 text-xs text-[#1A1918]"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...field.value]
                        next.splice(i, 1)
                        field.onChange(next)
                      }}
                      className="ml-0.5 text-[#7C7570] hover:text-[#1A1918]"
                      aria-label={`Remove tag ${tag}`}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              {(field.value?.length ?? 0) < 5 && (
                <input
                  type="text"
                  placeholder="Type and press Enter to add a tag"
                  className="h-9 w-full rounded-lg border border-[#D4CFC9] bg-white px-3 text-sm text-[#1A1918] placeholder:text-[#B0AAA4] focus:border-[#8B7355] focus:outline-none focus:ring-2 focus:ring-[#8B7355]/20"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const val = e.currentTarget.value.trim()
                      if (val && !(field.value ?? []).includes(val)) {
                        field.onChange([...(field.value ?? []), val])
                        e.currentTarget.value = ''
                      }
                    }
                  }}
                />
              )}
            </div>
          )}
        />
        {errors.tags && (
          <p className="text-xs text-red-600">{errors.tags.message}</p>
        )}
      </div>

      {/* Brand Logo */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-[#1A1918]">
          {isOwner ? 'Logo *' : 'Logo（可選）'}
        </label>
        <p className="text-xs text-[#7C7570]">
          Upload your brand logo (max 5MB, will be resized to max 1200px)
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

      <div className="space-y-3">
        <p className="text-sm font-semibold text-[#1A1918]">
          Founder Information{' '}
          <span className="text-xs font-normal text-[#7C7570]">(Optional)</span>
        </p>
        <div className="space-y-1.5">
          <label
            htmlFor="founder-name"
            className="block text-sm font-medium text-[#1A1918]"
          >
            Founder Name
          </label>
          <input
            id="founder-name"
            type="text"
            placeholder="e.g. Lin Wei-Chen"
            className="w-full rounded-lg border border-[#D4CFC9] bg-white px-3 py-2 text-sm text-[#1A1918] placeholder:text-[#B0AAA4] focus:border-[#8B7355] focus:outline-none focus:ring-2 focus:ring-[#8B7355]/20"
            {...register('founderName')}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="founder-title"
            className="block text-sm font-medium text-[#1A1918]"
          >
            Founder Title
          </label>
          <input
            id="founder-title"
            type="text"
            placeholder="e.g. Founder & CEO"
            className="w-full rounded-lg border border-[#D4CFC9] bg-white px-3 py-2 text-sm text-[#1A1918] placeholder:text-[#B0AAA4] focus:border-[#8B7355] focus:outline-none focus:ring-2 focus:ring-[#8B7355]/20"
            {...register('founderTitle')}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="founder-bio"
            className="block text-sm font-medium text-[#1A1918]"
          >
            Founder Bio
          </label>
          <textarea
            id="founder-bio"
            rows={3}
            placeholder="e.g. Started the brand after returning from Tokyo..."
            className="w-full rounded-lg border border-[#D4CFC9] bg-white px-3 py-2 text-sm text-[#1A1918] placeholder:text-[#B0AAA4] focus:border-[#8B7355] focus:outline-none focus:ring-2 focus:ring-[#8B7355]/20"
            {...register('founderBio')}
          />
        </div>
      </div>
    </div>
  )
}
