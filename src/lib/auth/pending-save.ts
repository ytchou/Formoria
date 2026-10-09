/**
 * A save a signed-out visitor asked for, carried across the sign-in round trip
 * so it can be applied once they come back signed in (DEV-1991).
 *
 * Stored in `sessionStorage`, not a cookie: session storage is scoped to one
 * tab, survives the same-tab OAuth and password sign-in round trips, and is
 * never readable by another tab or another person who later signs in on the
 * same browser in a fresh tab. Ceiling: a confirmation link opened in a new
 * tab (sign-up email) does not carry it, so that flow simply returns without
 * the save. Upgrade path, if that matters: a short-lived cookie set next to
 * `post_auth_next` and cleared by the auth callback.
 */

export type PendingSaveKind = 'brand' | 'product'

export type PendingSave = {
  kind: PendingSaveKind
  id: string
  createdAt: number
}

type PendingSaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const PENDING_SAVE_STORAGE_KEY = 'formoria:pending-save'

/** A marker older than this is ignored and removed. */
export const PENDING_SAVE_TTL_MS = 30 * 60 * 1000

export function serializePendingSave(
  kind: PendingSaveKind,
  id: string,
  now: number
): string {
  return JSON.stringify({ kind, id, createdAt: now } satisfies PendingSave)
}

/** Returns the marker, or null when it is missing, malformed, or expired. */
export function parsePendingSave(
  raw: string | null,
  now: number
): PendingSave | null {
  if (!raw) return null

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof value !== 'object' || value === null) return null
  const { kind, id, createdAt } = value as Record<string, unknown>
  if (kind !== 'brand' && kind !== 'product') return null
  if (typeof id !== 'string' || id === '') return null
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
  // A timestamp from the future is as untrustworthy as a stale one.
  if (createdAt > now || now - createdAt > PENDING_SAVE_TTL_MS) return null

  return { kind, id, createdAt }
}

export function matchesPendingSave(
  pending: PendingSave | null,
  kind: PendingSaveKind,
  id: string
): boolean {
  return pending !== null && pending.kind === kind && pending.id === id
}

export function writePendingSave(
  storage: PendingSaveStorage | null,
  kind: PendingSaveKind,
  id: string,
  now: number = Date.now()
): void {
  if (!storage) return
  try {
    storage.setItem(
      PENDING_SAVE_STORAGE_KEY,
      serializePendingSave(kind, id, now)
    )
  } catch {
    // Storage can be full or disabled; the visitor then signs in without the save.
  }
}

/**
 * Consumes the marker when it names this item: returns true and removes it, so
 * of several save buttons for the same item only the first applies it. An
 * expired or malformed marker is removed too. A valid marker for a different
 * item is left alone.
 */
export function takePendingSave(
  storage: PendingSaveStorage | null,
  kind: PendingSaveKind,
  id: string,
  now: number = Date.now()
): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(PENDING_SAVE_STORAGE_KEY)
    if (raw === null) return false

    const pending = parsePendingSave(raw, now)
    if (pending === null) {
      storage.removeItem(PENDING_SAVE_STORAGE_KEY)
      return false
    }
    if (!matchesPendingSave(pending, kind, id)) return false

    storage.removeItem(PENDING_SAVE_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/** `window.sessionStorage`, or null on the server or when access throws. */
export function sessionStorageOrNull(): PendingSaveStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
