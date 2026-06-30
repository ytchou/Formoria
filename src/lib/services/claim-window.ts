export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function isWithinClaimWindow(claimedAt: string | null): boolean {
  if (claimedAt === null) return false

  const claimedAtTime = new Date(claimedAt).getTime()
  if (Number.isNaN(claimedAtTime)) return false

  return Date.now() - claimedAtTime <= SEVEN_DAYS_MS
}
