import type {
  RetailLocation,
  RetailLocationRelationshipType,
  RetailLocationVerificationStatus,
} from '@/lib/types/brand'

const RELATIONSHIP_TYPES = new Set<RetailLocationRelationshipType>([
  'brand_store',
  'stockist',
  'department_counter',
])

const VERIFICATION_STATUSES = new Set<RetailLocationVerificationStatus>([
  'verified',
  'manual',
  'needs_review',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function normalizeRelationshipType(
  value: unknown,
): RetailLocationRelationshipType {
  return typeof value === 'string' &&
    RELATIONSHIP_TYPES.has(value as RetailLocationRelationshipType)
    ? (value as RetailLocationRelationshipType)
    : 'stockist'
}

function normalizeVerificationStatus(
  value: unknown,
  latitude?: number,
  longitude?: number,
): RetailLocationVerificationStatus {
  if (
    typeof value === 'string' &&
    VERIFICATION_STATUSES.has(value as RetailLocationVerificationStatus)
  ) {
    return value as RetailLocationVerificationStatus
  }
  return latitude !== undefined && longitude !== undefined ? 'verified' : 'manual'
}

function normalizeRetailLocation(value: unknown): RetailLocation | null {
  if (!isRecord(value)) return null

  const name = optionalString(value.name)
  const address = optionalString(value.address)
  const venueName = optionalString(value.venueName)
  const latitude = optionalNumber(value.latitude)
  const longitude = optionalNumber(value.longitude)
  const hasValidCoordinates =
    latitude !== undefined &&
    longitude !== undefined &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180

  if (!name && !address && !venueName) return null

  return {
    name: name ?? venueName ?? '',
    relationshipType: normalizeRelationshipType(value.relationshipType),
    address: address ?? '',
    city: optionalString(value.city),
    district: optionalString(value.district),
    venueName,
    floorOrCounter: optionalString(value.floorOrCounter),
    availabilityNote: optionalString(value.availabilityNote),
    latitude: hasValidCoordinates ? latitude : undefined,
    longitude: hasValidCoordinates ? longitude : undefined,
    verificationStatus: normalizeVerificationStatus(
      value.verificationStatus,
      hasValidCoordinates ? latitude : undefined,
      hasValidCoordinates ? longitude : undefined,
    ),
  }
}

export function normalizeRetailLocations(value: unknown): RetailLocation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((location) => {
    const normalized = normalizeRetailLocation(location)
    return normalized ? [normalized] : []
  })
}

export function hasLocationCoordinates(
  location: RetailLocation,
): location is RetailLocation & { latitude: number; longitude: number } {
  return (
    typeof location.latitude === 'number' &&
    Number.isFinite(location.latitude) &&
    typeof location.longitude === 'number' &&
    Number.isFinite(location.longitude)
  )
}

export function getLocationMapQuery(location: RetailLocation): string {
  return [location.name, location.venueName, location.address]
    .filter(Boolean)
    .join(' ')
}
