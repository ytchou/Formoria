'use client'

import { useFormContext, useFieldArray } from 'react-hook-form'
import { Plus, Trash2 } from 'lucide-react'
import type { SubmissionFormData } from '@/lib/validations/submission'

const PLATFORM_OPTIONS = [
  { value: 'shopee', label: 'Shopee' },
  { value: 'pchome', label: 'PChome' },
  { value: 'momo', label: 'Momo' },
  { value: 'pinkoi', label: 'Pinkoi' },
  { value: 'official', label: 'Official Site' },
  { value: 'other', label: 'Other' },
]

type LinksStepProps = {
  isOwner?: boolean
}

export function LinksStep({ isOwner = false }: LinksStepProps = {}) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<SubmissionFormData>()

  const {
    fields: purchaseFields,
    append: appendPurchase,
    remove: removePurchase,
  } = useFieldArray({ control, name: 'purchaseLinks' })

  const {
    fields: locationFields,
    append: appendLocation,
    remove: removeLocation,
  } = useFieldArray({ control, name: 'retailLocations' })

  return (
    <div className="space-y-8">
      {/* Purchase Links */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {isOwner ? 'Purchase Links *' : 'Purchase Links（可選）'}
          </h3>
          <p className="text-xs text-muted-foreground">
            Add links where people can buy your products
          </p>
        </div>

        <div className="space-y-2">
          {purchaseFields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <select
                role="combobox"
                className="h-11 w-40 shrink-0 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
                {...register(`purchaseLinks.${index}.platform`)}
              >
                <option value="">Platform</option>
                {PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <input
                type="url"
                placeholder="https://..."
                className="h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
                {...register(`purchaseLinks.${index}.url`)}
              />
              {purchaseFields.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePurchase(index)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={`Remove purchase link ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {errors.purchaseLinks && (
          <p className="text-xs text-red-600">
            {typeof errors.purchaseLinks.message === 'string'
              ? errors.purchaseLinks.message
              : 'Please add at least one purchase link'}
          </p>
        )}

        <button
          type="button"
          onClick={() => appendPurchase({ platform: '', url: '' })}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground/80"
        >
          <Plus className="h-4 w-4" />
          Add another link
        </button>
      </div>

      {/* Social Links */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Social Links</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <label
              htmlFor="social-instagram"
              className="w-28 shrink-0 text-sm text-muted-foreground"
            >
              Instagram
            </label>
            <input
              id="social-instagram"
              type="text"
              placeholder="@yourbrand"
              className="h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
              {...register('socialLinks.instagram')}
            />
          </div>
          <div className="flex items-center gap-3">
            <label
              htmlFor="social-threads"
              className="w-28 shrink-0 text-sm text-muted-foreground"
            >
              Threads
            </label>
            <input
              id="social-threads"
              type="text"
              placeholder="@yourbrand"
              className="h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
              {...register('socialLinks.threads')}
            />
          </div>
          <div className="flex items-center gap-3">
            <label
              htmlFor="social-facebook"
              className="w-28 shrink-0 text-sm text-muted-foreground"
            >
              Facebook
            </label>
            <input
              id="social-facebook"
              type="text"
              placeholder="https://facebook.com/yourbrand"
              className="h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
              {...register('socialLinks.facebook')}
            />
          </div>
          <div className="flex items-center gap-3">
            <label
              htmlFor="social-website"
              className="w-28 shrink-0 text-sm text-muted-foreground"
            >
              Website
            </label>
            <input
              id="social-website"
              type="url"
              placeholder="https://yourbrand.com"
              className="h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
              {...register('socialLinks.website')}
            />
          </div>
        </div>
      </div>

      {/* Retail Locations */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Retail Locations
          </h3>
          <p className="text-xs text-muted-foreground">
            Physical locations where your products are sold (optional)
          </p>
        </div>

        {locationFields.length > 0 && (
          <div className="space-y-2">
            {locationFields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <input
                  type="text"
                  placeholder="Store name"
                  className="h-11 w-40 shrink-0 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
                  {...register(`retailLocations.${index}.name`)}
                />
                <input
                  type="text"
                  placeholder="Address"
                  className="h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
                  {...register(`retailLocations.${index}.address`)}
                />
                <button
                  type="button"
                  onClick={() => removeLocation(index)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={`Remove location ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => appendLocation({ name: '', address: '' })}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground/80"
        >
          <Plus className="h-4 w-4" />
          Add location
        </button>
      </div>
    </div>
  )
}
