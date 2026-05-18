'use client'

import { useFormContext, Controller } from 'react-hook-form'
import { ImageUploader } from '../upload/ImageUploader'
import type { SubmissionFormData } from '@/lib/validations/submission'

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
}

export function BrandInfoStep({ categories, uploadPath }: BrandInfoStepProps) {
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
          Brand Logo
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
              bucket="brand-assets"
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
