'use client'

import { useState } from 'react'
import { setFeatureFlagAction } from '@/app/admin/actions'
import { SurfaceCard } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { FEATURE_FLAGS } from '@/lib/services/app-settings'

export function FeatureTogglesCard({
  initialValues,
}: {
  initialValues: Record<string, boolean>
}) {
  const [values, setValues] = useState(initialValues)
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set())

  async function handleCheckedChange(key: string, nextEnabled: boolean) {
    setValues((current) => ({ ...current, [key]: nextEnabled }))
    setSavingKeys((current) => new Set(current).add(key))

    try {
      const result = await setFeatureFlagAction(key, nextEnabled)
      if (result?.error) {
        setValues((current) => ({ ...current, [key]: !nextEnabled }))
      }
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="type-section-title-large">Feature Toggles</h2>
      </div>
      <SurfaceCard padding="lg">
        {FEATURE_FLAGS.map((flag) => (
          <div
            key={flag.key}
            className="flex min-h-12 items-center justify-between gap-4"
          >
            <div>
              <Label htmlFor={`${flag.key}-toggle`}>{flag.label}</Label>
              <p className="mt-1 type-card-description">{flag.description}</p>
            </div>
            <Switch
              id={`${flag.key}-toggle`}
              checked={values[flag.key] ?? flag.defaultValue}
              disabled={savingKeys.has(flag.key)}
              onCheckedChange={(nextEnabled) =>
                handleCheckedChange(flag.key, nextEnabled)
              }
            />
          </div>
        ))}
      </SurfaceCard>
    </section>
  )
}
