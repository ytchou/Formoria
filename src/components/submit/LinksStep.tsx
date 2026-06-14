'use client'

import { useFormContext, useFieldArray } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Plus, Trash2 } from 'lucide-react'
import type { SubmissionFormData } from '@/lib/validations/submission'

export function LinksStep() {
  const t = useTranslations('submit.fields')
  const {
    register,
    control,
  } = useFormContext<SubmissionFormData>()

  const {
    fields: locationFields,
    append: appendLocation,
    remove: removeLocation,
  } = useFieldArray({ control, name: 'retailLocations' })

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t('retailLocations')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('retailLocationsHint')}
          </p>
        </div>

        {locationFields.length > 0 && (
          <div className="space-y-2">
            {locationFields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <input
                  type="text"
                  placeholder={t('storeName')}
                  className="h-11 w-40 shrink-0 rounded-lg border border-border bg-white px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-muted-foreground/20"
                  {...register(`retailLocations.${index}.name`)}
                />
                <input
                  type="text"
                  placeholder={t('address')}
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
          {t('addLocation')}
        </button>
      </div>
    </div>
  )
}
