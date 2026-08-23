import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'

/**
 * Write-path guard for owner-only server actions: refuse before auth so a stale
 * client that still holds a form cannot write while the surface is hidden.
 * Returns a boolean rather than throwing so each action keeps its own error
 * shape (`{ error: 'forbidden' }`, `{ error: t('forbidden') }`, …).
 *
 * It answers only "is the owner surface on at all" — per-brand authorization is
 * a separate check at each call site.
 */
export async function requireOwnerFeaturesEnabled(): Promise<boolean> {
  return isOwnerFeaturesEnabled()
}
