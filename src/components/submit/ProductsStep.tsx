'use client'

import { useFormContext, Controller } from 'react-hook-form'
import { ImageUploader } from '../upload/ImageUploader'
import type { SubmissionFormData } from '@/lib/validations/submission'

type ProductsStepProps = {
  uploadPath: string
}

export function ProductsStep({ uploadPath }: ProductsStepProps) {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext<SubmissionFormData>()

  const highlights = watch('brandHighlights') ?? ''

  return (
    <div className="space-y-6">
      {/* Product Photos */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">
          Product Photos
        </label>
        <p className="text-xs text-muted-foreground">
          Upload up to 6 photos to showcase your products
        </p>
        <Controller
          name="productPhotos"
          control={control}
          render={({ field }) => (
            <ImageUploader
              mode="multi"
              bucket="brand-images"
              path={`${uploadPath}/photos`}
              value={field.value}
              onUpload={(url) => field.onChange([...(field.value ?? []), url])}
              onRemove={(index) => {
                const next = [...(field.value ?? [])]
                next.splice(index, 1)
                field.onChange(next)
              }}
              maxFiles={6}
            />
          )}
        />
        {errors.productPhotos && (
          <p className="text-xs text-red-600">
            {errors.productPhotos.message}
          </p>
        )}
      </div>

      {/* Brand Highlights */}
      <div className="space-y-1.5">
        <label
          htmlFor="brand-highlights"
          className="block text-sm font-semibold text-foreground"
        >
          Brand Highlights
        </label>
        <p className="text-xs text-muted-foreground">
          What makes your brand special?
        </p>
        <textarea
          id="brand-highlights"
          rows={3}
          placeholder="e.g. Handcrafted with local Taiwanese cedar..."
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
          {...register('brandHighlights')}
        />
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground">
            {highlights.length} / 300
          </span>
        </div>
        {errors.brandHighlights && (
          <p className="text-xs text-red-600">
            {errors.brandHighlights.message}
          </p>
        )}
      </div>
    </div>
  )
}
