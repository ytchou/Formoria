'use client'

import { useState, useTransition } from 'react'
import { setFeatureFlagAction } from '@/app/admin/actions'
import { SurfaceCard } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SUBCATEGORY_FILTER_KEY } from '@/lib/services/app-settings'

export function FeatureTogglesCard({
  initialSubcategoryFilterEnabled,
}: {
  initialSubcategoryFilterEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialSubcategoryFilterEnabled)
  const [isPending, startTransition] = useTransition()

  function handleCheckedChange(nextEnabled: boolean) {
    setEnabled(nextEnabled)
    startTransition(async () => {
      const result = await setFeatureFlagAction(
        SUBCATEGORY_FILTER_KEY,
        nextEnabled
      )
      if (result?.error) setEnabled(!nextEnabled)
    })
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="type-section-title-large">Feature Toggles</h2>
      </div>
      <SurfaceCard padding="lg">
        <div className="flex min-h-12 items-center justify-between gap-4">
          <div>
            <Label htmlFor="subcategory-filter-toggle">
              Subcategory filter on /brands
            </Label>
            <p className="mt-1 type-card-description">
              Shows product-type chips in the directory filter sidebar
            </p>
          </div>
          <Switch
            id="subcategory-filter-toggle"
            checked={enabled}
            disabled={isPending}
            onCheckedChange={handleCheckedChange}
          />
        </div>
      </SurfaceCard>
    </section>
  )
}
