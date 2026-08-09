/**
 * Crop damage — how much of a source image is destroyed by the fixed-ratio box
 * it renders into.
 *
 * Brand images render into an `aspect-[4/3]` box with `object-cover`, so any
 * source that is not already 4/3 gets cut on one axis. Hero ranking used to
 * approximate that with a flat portrait penalty; this computes the damage the
 * image will actually receive, so a mildly-tall photo and a phone-screenshot
 * strip are no longer charged the same amount.
 *
 * Pure and client-safe by construction: no `sharp`, no services, no DB, no Node
 * built-ins. A renderer is expected to import this alongside `./focal`.
 */

import { HERO_TARGET_RATIO } from '@/lib/constants/brand-images'

export type CropDamageInput = {
  width: number | null | undefined
  height: number | null | undefined
  /** Normalised focal point in [0, 1]; null when the image was never measured. */
  focalX?: number | null
  focalY?: number | null
  /** Logos render `object-contain` and are never cropped — see below. */
  isLogo?: boolean
  /** Aspect ratio of the box the image renders into. Defaults to the hero box. */
  targetRatio?: number
  /** Whether the renderer honours the focal point. Defaults to false — see below. */
  focalAware?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Damage in [0, 1] — 0 means the image survives the crop intact, 1 means it is
 * destroyed.
 */
export function cropDamage(input: CropDamageInput): number {
  const {
    width,
    height,
    focalX,
    focalY,
    isLogo = false,
    targetRatio = HERO_TARGET_RATIO,
    focalAware = false,
  } = input

  // (1) Logos are exempt, and this is load-bearing rather than a shortcut.
  // Logo cards render `object-contain` (see `src/components/brands/brand-card.tsx`),
  // which letterboxes instead of cutting — the crop this function models simply
  // does not happen to them. 83 of 844 production heroes are logos, and they
  // skew far from 4/3, so charging them for an imaginary crop would demote a
  // tenth of the catalogue's heroes for nothing.
  if (isLogo) return 0

  // (2) Unmeasured or nonsensical dimensions score 0, preserving today's
  // behaviour. 247 of 6,408 active rows carry null dimensions; they are
  // currently unpenalised, and guessing a penalty for them would reshuffle
  // heroes on missing metadata rather than on real framing.
  if (!width || !height || width <= 0 || height <= 0) return 0

  const a = width / height
  const t = targetRatio

  // Fraction of the source area that survives a cover crop. Symmetric in a/t:
  // the shorter ratio over the longer one is the same whether the source is too
  // tall or too wide, and only one axis is ever cut.
  const visible = Math.min(a, t) / Math.max(a, t)
  const areaLoss = 1 - visible

  // The focal coordinate on the axis actually being cut. A source wider than the
  // box loses its sides (x); a source taller than the box loses top and bottom
  // (y). A missing measurement means centre, which is what the renderer does.
  const f = a > t ? (focalX ?? 0.5) : (focalY ?? 0.5)

  // (4) `focalAware` defaults to false because ranking must model what actually
  // ships, and the renderers currently emit bare centred `object-cover`. Flip
  // the default in the same commit that teaches the renderer to honour focal
  // points: if the two ever disagree, ranking systematically mis-scores exactly
  // the images the renderer frames well, and no test or metric would catch it.
  const windowStart = focalAware
    ? // The renderer slides the visible window to sit on the focal point, as far
      // as the source edges allow.
      clamp(f - visible / 2, 0, 1 - visible)
    : // Today's renderers emit bare centred `object-cover`, so the window is
      // pinned to the middle regardless of where the subject is.
      (1 - visible) / 2
  const windowCentre = windowStart + visible / 2

  // How far the subject sits from the centre of what survives, in units of half
  // the visible window: 0 when the subject is dead centre, 1 once it is at (or
  // past) the edge of the crop.
  const focalMiss = clamp(Math.abs(f - windowCentre) / (visible / 2), 0, 1)

  // (3) The focal term multiplies, it does not add. When `areaLoss` is 0 — an
  // exact-4/3 source — nothing is cut, so where the subject sits is irrelevant
  // and must contribute exactly nothing. An additive term would penalise a
  // perfectly-framed image for having an off-centre subject, which is a
  // composition choice, not damage.
  return clamp(areaLoss * (1 + focalMiss), 0, 1)
}
