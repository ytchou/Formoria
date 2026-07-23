'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { isPhysicalRetailLocation, isRetailChainChannel, normalizeRetailLocations } from '@/lib/brands/locations'
import type { PhysicalRetailLocation, RetailLocation, RetailLocationRelationshipType } from '@/lib/types/brand'

type Props = {
  value: unknown
  onChange?: (value: RetailLocation[]) => void
  readOnly?: boolean
  candidates?: LocationCandidateEvidence[]
}

export type LocationCandidateEvidence = {
  id: string
  location: unknown
  verificationDecision: string
  matchReason: string
  evidence: unknown
}

const EMPTY_LOCATION: RetailLocation = {
  kind: 'location',
  name: '',
  relationshipType: 'stockist',
  confirmationStatus: 'unconfirmed',
  verificationStatus: 'needs_review',
}

function editableLocations(value: unknown): RetailLocation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const [normalized] = normalizeRetailLocations([raw])
    if (normalized) return [normalized]
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
    const record = raw as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : ''
    if (record.kind === 'retail_chain') return [{ kind: 'retail_chain', name }]
    if (record.kind === 'location') return [{ ...EMPTY_LOCATION, name }]
    return []
  })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="block space-y-1.5">
      <span>{label}</span>
      {children}
    </Label>
  )
}

function locationLabel(t: ReturnType<typeof useTranslations>, location: RetailLocation): string {
  if (isRetailChainChannel(location)) return t('details.locationEditor.chain')
  return t(`details.locationEditor.relationship.${location.relationshipType}`)
}

function statusLabel(t: ReturnType<typeof useTranslations>, status: string | undefined): string {
  return t(`details.locationEditor.status.${status ?? 'needs_review'}`)
}

function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

function candidateLocation(candidate: LocationCandidateEvidence): RetailLocation | undefined {
  return normalizeRetailLocations([candidate.location]).at(0)
}

function normalizeLocationKey(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, '').toLocaleLowerCase() ?? ''
}

function locationAddressKey(value: string | undefined): string {
  return normalizeLocationKey(value).replace(/[，,。．.、\-—_#號樓室]/g, '')
}

function locationIdentity(location: PhysicalRetailLocation): string {
  return [location.name, location.city, location.venueName].map(normalizeLocationKey).join('|')
}

export function RetailLocationsEditor({ value, onChange, readOnly = false, candidates = [] }: Props) {
  const t = useTranslations('admin.submissions')
  const locations = readOnly ? normalizeRetailLocations(value) : editableLocations(value)

  function update(index: number, next: RetailLocation) {
    onChange?.(locations.map((location, locationIndex) => (locationIndex === index ? next : location)))
  }

  function remove(index: number) {
    onChange?.(locations.filter((_, locationIndex) => locationIndex !== index))
  }

  function add(kind: 'location' | 'retail_chain') {
    onChange?.([...locations, kind === 'location' ? { ...EMPTY_LOCATION } : { kind: 'retail_chain', name: '' }])
  }

  function acceptCandidate(candidate: LocationCandidateEvidence) {
    const accepted = candidateLocation(candidate)
    if (!accepted || !isPhysicalRetailLocation(accepted)) return
    const normalizedAccepted: PhysicalRetailLocation = {
      ...accepted,
      verificationStatus: 'verified',
      confirmationStatus: 'unconfirmed',
    }
    const acceptedAddress = locationAddressKey(normalizedAccepted.address)
    const acceptedIdentity = locationIdentity(normalizedAccepted)
    const byAddress = acceptedAddress
      ? locations.findIndex(
          (location) =>
            isPhysicalRetailLocation(location) &&
            locationAddressKey(location.address) === acceptedAddress,
        )
      : -1
    const byIdentity = locations.findIndex(
      (location) => isPhysicalRetailLocation(location) && locationIdentity(location) === acceptedIdentity,
    )
    const existingIndex = byAddress >= 0 ? byAddress : byIdentity
    if (existingIndex < 0) {
      onChange?.([...locations, normalizedAccepted])
      return
    }
    const existing = locations.at(existingIndex)
    if (!existing || !isPhysicalRetailLocation(existing)) return
    onChange?.(
      locations.map((location, index) =>
        index === existingIndex
          ? {
              ...existing,
              ...normalizedAccepted,
              confirmationStatus: existing.confirmationStatus,
            }
          : location,
      ),
    )
  }

  function renderCandidates(editable: boolean) {
    if (candidates.length === 0) return null
    return (
      <div className="space-y-2 rounded-md bg-muted/40 p-3">
        <p className="type-metadata">{t('details.locationEditor.evidence')}</p>
        {candidates.map((candidate) => {
          const location = candidateLocation(candidate)
          return (
            <div key={candidate.id} className="space-y-1 type-card-description">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={candidate.verificationDecision === 'verified' ? 'success' : 'warning'}>
                  {statusLabel(t, candidate.verificationDecision)}
                </Badge>
                {location && isPhysicalRetailLocation(location) ? <span>{location.name}</span> : null}
              </div>
              {location && isPhysicalRetailLocation(location) ? (
                <>
                  {location.address ? <p>{location.address}</p> : null}
                  {location.latitude !== undefined && location.longitude !== undefined ? (
                    <p>
                      {t('details.locationEditor.coordinates', {
                        latitude: location.latitude,
                        longitude: location.longitude,
                      })}
                    </p>
                  ) : null}
                </>
              ) : null}
              <p>{candidate.matchReason}</p>
              {Array.isArray(candidate.evidence)
                ? candidate.evidence.map((item, evidenceIndex) => {
                    if (typeof item !== 'object' || item === null) return null
                    const record = item as Record<string, unknown>
                    const url = safeSourceUrl(record.url)
                    return url ? (
                      <a
                        key={`${url}-${evidenceIndex}`}
                        className="type-link break-all"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {url}
                      </a>
                    ) : null
                  })
                : null}
              {editable && candidate.verificationDecision === 'needs_review' ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-12"
                  onClick={() => acceptCandidate(candidate)}
                >
                  {t('details.locationEditor.acceptCandidate')}
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className="space-y-3">
        {locations.length === 0 ? <p className="type-card-description">—</p> : null}
        {locations.map((location, index) => (
          <div key={`${location.kind}-${location.name}-${index}`} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="type-body-emphasis">{location.name || t('details.locationEditor.unnamed')}</p>
              <Badge variant="secondary">{locationLabel(t, location)}</Badge>
              {isPhysicalRetailLocation(location) ? (
                <Badge variant={location.verificationStatus === 'verified' ? 'success' : 'warning'}>
                  {statusLabel(t, location.verificationStatus)}
                </Badge>
              ) : null}
            </div>
            {isPhysicalRetailLocation(location) ? (
              <div className="mt-2 space-y-1 type-card-description">
                {location.address ? <p>{location.address}</p> : null}
                {location.city || location.venueName || location.floorOrCounter ? (
                  <p>{[location.city, location.venueName, location.floorOrCounter].filter(Boolean).join(' · ')}</p>
                ) : null}
                {location.latitude !== undefined && location.longitude !== undefined ? (
                  <p>
                    {t('details.locationEditor.coordinates', {
                      latitude: location.latitude,
                      longitude: location.longitude,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {renderCandidates(false)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {locations.map((location, index) => (
        <div key={`${location.kind}-${index}`} className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="type-body-emphasis">{t('details.locationEditor.item', { number: index + 1 })}</p>
            <Button
              type="button"
              variant="ghost"
              className="min-h-12"
              onClick={() => remove(index)}
              aria-label={t('details.locationEditor.remove', {
                number: index + 1,
              })}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t('details.locationEditor.removeLabel')}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('details.locationEditor.kind')}>
              <NativeSelect
                value={location.kind}
                onChange={(event) => {
                  if (event.target.value === 'retail_chain')
                    update(index, {
                      kind: 'retail_chain',
                      name: location.name,
                    })
                  else update(index, { ...EMPTY_LOCATION, name: location.name })
                }}
              >
                <option value="location">{t('details.locationEditor.physical')}</option>
                <option value="retail_chain">{t('details.locationEditor.chain')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('details.locationEditor.name')}>
              <Input
                value={location.name}
                onChange={(event) => update(index, { ...location, name: event.target.value })}
              />
            </Field>
          </div>
          {isPhysicalRetailLocation(location) ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('details.locationEditor.relationshipLabel')}>
                  <NativeSelect
                    value={location.relationshipType}
                    onChange={(event) =>
                      update(index, {
                        ...location,
                        relationshipType: event.target.value as RetailLocationRelationshipType,
                      })
                    }
                  >
                    <option value="brand_store">{t('details.locationEditor.relationship.brand_store')}</option>
                    <option value="stockist">{t('details.locationEditor.relationship.stockist')}</option>
                    <option value="department_counter">
                      {t('details.locationEditor.relationship.department_counter')}
                    </option>
                  </NativeSelect>
                </Field>
                <Field label={t('details.locationEditor.statusLabel')}>
                  <NativeSelect
                    value={location.verificationStatus ?? 'needs_review'}
                    onChange={(event) =>
                      update(index, {
                        ...location,
                        verificationStatus: event.target.value as 'verified' | 'manual' | 'needs_review',
                      })
                    }
                  >
                    <option value="verified">{statusLabel(t, 'verified')}</option>
                    <option value="manual">{statusLabel(t, 'manual')}</option>
                    <option value="needs_review">{statusLabel(t, 'needs_review')}</option>
                  </NativeSelect>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('details.locationEditor.address')}>
                  <Input
                    value={location.address ?? ''}
                    onChange={(event) =>
                      update(index, {
                        ...location,
                        address: event.target.value || undefined,
                      })
                    }
                  />
                </Field>
                <Field label={t('details.locationEditor.city')}>
                  <Input
                    value={location.city ?? ''}
                    onChange={(event) =>
                      update(index, {
                        ...location,
                        city: event.target.value || undefined,
                      })
                    }
                  />
                </Field>
                <Field label={t('details.locationEditor.venue')}>
                  <Input
                    value={location.venueName ?? ''}
                    onChange={(event) =>
                      update(index, {
                        ...location,
                        venueName: event.target.value || undefined,
                      })
                    }
                  />
                </Field>
                <Field label={t('details.locationEditor.floor')}>
                  <Input
                    value={location.floorOrCounter ?? ''}
                    onChange={(event) =>
                      update(index, {
                        ...location,
                        floorOrCounter: event.target.value || undefined,
                      })
                    }
                  />
                </Field>
                <Field label={t('details.locationEditor.latitude')}>
                  <Input
                    type="number"
                    value={location.latitude ?? ''}
                    onChange={(event) =>
                      update(index, {
                        ...location,
                        latitude: event.target.value ? Number(event.target.value) : undefined,
                      })
                    }
                  />
                </Field>
                <Field label={t('details.locationEditor.longitude')}>
                  <Input
                    type="number"
                    value={location.longitude ?? ''}
                    onChange={(event) =>
                      update(index, {
                        ...location,
                        longitude: event.target.value ? Number(event.target.value) : undefined,
                      })
                    }
                  />
                </Field>
              </div>
            </>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" className="min-h-12" onClick={() => add('location')}>
          <Plus className="size-4" aria-hidden="true" />
          {t('details.locationEditor.addLocation')}
        </Button>
        <Button type="button" variant="secondary" className="min-h-12" onClick={() => add('retail_chain')}>
          <Plus className="size-4" aria-hidden="true" />
          {t('details.locationEditor.addChain')}
        </Button>
      </div>
      {renderCandidates(true)}
    </div>
  )
}
