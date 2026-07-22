import type {
  PhysicalRetailLocation,
  RetailChainChannel,
  RetailLocation,
  RetailLocationRelationshipType,
  RetailLocationType,
  RetailLocationVerificationStatus,
} from '@/lib/types/brand'

const RELATIONSHIP_TYPES = new Set<RetailLocationRelationshipType>([
  'brand_store',
  'stockist',
  'department_counter',
])

const LOCATION_TYPES = new Set<RetailLocationType>(['chain', 'independent'])

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
  return trimmed || undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function sanitizeHttpUrl(value: unknown): string | undefined {
  const trimmed = optionalString(value)
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? trimmed
      : undefined
  } catch {
    return undefined
  }
}

function normalizeTextIdentity(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    : ''
}

function getLocationAddressKey(address: unknown): string {
  return typeof address === 'string'
    ? address.trim().replace(/\s+/g, '').toLocaleLowerCase()
    : ''
}

function getValidCoordinates(location: {
  latitude?: unknown
  longitude?: unknown
}): { latitude: number; longitude: number } | undefined {
  const latitude = optionalNumber(location.latitude)
  const longitude = optionalNumber(location.longitude)
  if (
    latitude === undefined ||
    longitude === undefined ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined
  }
  return { latitude, longitude }
}

function getLocationCoordinateKey(location: {
  latitude?: unknown
  longitude?: unknown
}): string {
  const coordinates = getValidCoordinates(location)
  return coordinates
    ? `${coordinates.latitude.toFixed(6)},${coordinates.longitude.toFixed(6)}`
    : ''
}

function getRetailerUrlKey(value: unknown): string {
  const sanitized = sanitizeHttpUrl(value)
  if (!sanitized) return ''

  const url = new URL(sanitized)
  url.hash = ''
  return url.toString()
}

function normalizeRelationshipType(
  value: unknown,
): RetailLocationRelationshipType {
  return typeof value === 'string' &&
    RELATIONSHIP_TYPES.has(value as RetailLocationRelationshipType)
    ? (value as RetailLocationRelationshipType)
    : 'stockist'
}

function normalizeLocationType(value: unknown): RetailLocationType | undefined {
  return typeof value === 'string' &&
    LOCATION_TYPES.has(value as RetailLocationType)
    ? (value as RetailLocationType)
    : undefined
}

function normalizeVerificationStatus(
  value: unknown,
  hasValidCoordinates: boolean,
): RetailLocationVerificationStatus {
  if (
    typeof value === 'string' &&
    VERIFICATION_STATUSES.has(value as RetailLocationVerificationStatus)
  ) {
    return value as RetailLocationVerificationStatus
  }
  return hasValidCoordinates ? 'verified' : 'manual'
}

function getCanonicalKind(
  value: Record<string, unknown>,
  address: string | undefined,
  hasValidCoordinates: boolean,
): RetailLocation['kind'] {
  if (value.kind === 'location' || value.kind === 'retail_chain') {
    return value.kind
  }
  if (address || hasValidCoordinates) return 'location'
  return normalizeLocationType(value.type ?? value.locationKind) === 'chain'
    ? 'retail_chain'
    : 'location'
}

function normalizeRetailLocation(value: unknown): RetailLocation | null {
  if (!isRecord(value)) return null

  const name = optionalString(value.name)
  const venueName = optionalString(value.venueName)
  const canonicalName = name ?? venueName
  if (!canonicalName) return null

  const address = optionalString(value.address)
  const coordinates = getValidCoordinates(value)
  const kind = getCanonicalKind(value, address, Boolean(coordinates))

  if (kind === 'retail_chain') {
    return {
      kind,
      name: canonicalName,
      retailerUrl: sanitizeHttpUrl(value.retailerUrl),
      availabilityNote: optionalString(value.availabilityNote),
    }
  }

  const isCanonical = value.kind === 'location'
  return {
    kind,
    name: canonicalName,
    relationshipType: normalizeRelationshipType(value.relationshipType),
    address,
    city: optionalString(value.city),
    district: optionalString(value.district),
    venueName,
    floorOrCounter: optionalString(value.floorOrCounter),
    availabilityNote: optionalString(value.availabilityNote),
    latitude: coordinates?.latitude,
    longitude: coordinates?.longitude,
    verificationStatus: normalizeVerificationStatus(
      value.verificationStatus,
      Boolean(coordinates),
    ),
    confirmationStatus:
      isCanonical && value.confirmationStatus === 'owner_confirmed'
        ? 'owner_confirmed'
        : 'unconfirmed',
  }
}

export function normalizeRetailLocations(value: unknown): RetailLocation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((location) => {
    const normalized = normalizeRetailLocation(location)
    return normalized ? [normalized] : []
  })
}

export function isPhysicalRetailLocation(
  location: RetailLocation,
): location is PhysicalRetailLocation {
  return location.kind === 'location'
}

export function isRetailChainChannel(
  location: RetailLocation,
): location is RetailChainChannel {
  return location.kind === 'retail_chain'
}

export function hasValidRetailLocationCoordinates(
  location: RetailLocation,
): location is PhysicalRetailLocation & { latitude: number; longitude: number } {
  return (
    isPhysicalRetailLocation(location) && Boolean(getValidCoordinates(location))
  )
}

export const hasLocationCoordinates = hasValidRetailLocationCoordinates

export function isMappableRetailLocation(
  location: RetailLocation,
): location is PhysicalRetailLocation & { latitude: number; longitude: number } {
  return hasValidRetailLocationCoordinates(location)
}

export function getLocationMapQuery(location: RetailLocation): string {
  return isPhysicalRetailLocation(location)
    ? [location.name, location.venueName, location.address].filter(Boolean).join(' ')
    : location.name
}

export function getDuplicateRetailLocationIndex(
  locations: readonly unknown[],
): number | undefined {
  const physicalAddresses = new Set<string>()
  const physicalCoordinates = new Set<string>()
  const chainNames = new Set<string>()
  const chainUrls = new Set<string>()

  for (const [index, value] of locations.entries()) {
    const location = normalizeRetailLocation(value)
    if (!location) continue

    if (isPhysicalRetailLocation(location)) {
      const addressKey = getLocationAddressKey(location.address)
      if (addressKey && physicalAddresses.has(addressKey)) return index
      if (addressKey) physicalAddresses.add(addressKey)

      const coordinateKey = getLocationCoordinateKey(location)
      if (coordinateKey && physicalCoordinates.has(coordinateKey)) return index
      if (coordinateKey) physicalCoordinates.add(coordinateKey)
      continue
    }

    const nameKey = normalizeTextIdentity(location.name)
    if (nameKey && chainNames.has(nameKey)) return index
    if (nameKey) chainNames.add(nameKey)

    const urlKey = getRetailerUrlKey(location.retailerUrl)
    if (urlKey && chainUrls.has(urlKey)) return index
    if (urlKey) chainUrls.add(urlKey)
  }

  return undefined
}

function getRetailLocationConfirmationIdentity(location: RetailLocation): string {
  if (isRetailChainChannel(location)) {
    return ['retail_chain', normalizeTextIdentity(location.name)].join('|')
  }

  return [
    'location',
    normalizeTextIdentity(location.name),
    location.relationshipType,
    getLocationAddressKey(location.address),
    normalizeTextIdentity(location.venueName),
    normalizeTextIdentity(location.floorOrCounter),
  ].join('|')
}

export function reconcileRetailLocationConfirmation({
  previous,
  next,
  isActualOwner,
}: {
  previous?: RetailLocation
  next: RetailLocation
  isActualOwner: boolean
}): RetailLocation {
  if (isRetailChainChannel(next)) {
    return {
      kind: 'retail_chain',
      name: next.name,
      ...(next.retailerUrl ? { retailerUrl: next.retailerUrl } : {}),
      ...(next.availabilityNote
        ? { availabilityNote: next.availabilityNote }
        : {}),
    }
  }

  if (isActualOwner) {
    const canConfirm =
      next.confirmationStatus === 'owner_confirmed' &&
      Boolean(optionalString(next.address))
    return {
      ...next,
      confirmationStatus: canConfirm
        ? ('owner_confirmed' as const)
        : ('unconfirmed' as const),
    }
  }

  const canPreserve =
    previous !== undefined &&
    isPhysicalRetailLocation(previous) &&
    previous.confirmationStatus === 'owner_confirmed' &&
    getRetailLocationConfirmationIdentity(previous) ===
      getRetailLocationConfirmationIdentity(next)

  return {
    ...next,
    confirmationStatus: canPreserve
      ? ('owner_confirmed' as const)
      : ('unconfirmed' as const),
  }
}

export function reconcileRetailLocationConfirmations({
  previous = [],
  next,
  isActualOwner,
}: {
  previous?: readonly RetailLocation[]
  next: readonly RetailLocation[]
  isActualOwner: boolean
}): RetailLocation[] {
  const availablePrevious = previous.map((location) => ({
    identity: getRetailLocationConfirmationIdentity(location),
    location,
    matched: false,
  }))

  return next.map((location) => {
    const identity = getRetailLocationConfirmationIdentity(location)
    const match = availablePrevious.find(
      (candidate) => !candidate.matched && candidate.identity === identity,
    )
    if (match) match.matched = true

    return reconcileRetailLocationConfirmation({
      previous: match?.location,
      next: location,
      isActualOwner,
    })
  })
}
