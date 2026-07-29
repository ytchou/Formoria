import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'

/**
 * Write-path guard for owner-only server actions: refuse before auth so a stale
 * client that still holds a form cannot write while the surface is hidden.
 * Returns a boolean rather than throwing so each action keeps its own error
 * shape (`{ error: 'forbidden' }`, `{ error: t('forbidden') }`, …).
 *
 * Deliberately NOT folded into `requireBrandEditor`: that helper also backs the
 * dashboard layout and the brand edit page, which admins must keep reaching
 * while the flag is off for impersonation / view-as-owner QA.
 */
export async function requireOwnerFeaturesEnabled(): Promise<boolean> {
  return isOwnerFeaturesEnabled()
}
