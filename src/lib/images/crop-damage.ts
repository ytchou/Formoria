/**
 * Crop damage — how much of a source image is destroyed by the fixed-ratio box
 * it renders into.
 *
 * Brand images render into a fixed box with `object-cover`, so any source that
 * is not already that shape gets cut on one axis. Hero ranking used to
 * approximate that with a flat portrait penalty; this computes the damage the
 * image will actually receive, so a mildly-tall photo and a phone-screenshot
 * strip are no longer charged the same amount.
 *
 * The default `targetRatio` is `HERO_TARGET_RATIO`, which still reads 4/3 while
 * the render box is 1:1 — see the comment on that constant for why the two are
 * deliberately not moved together.
 *
 * Pure and client-safe by construction: no `sharp`, no services, no DB, no Node
 * built-ins.
 */

import { HERO_TARGET_RATIO } from '@/lib/constants/brand-images'

export type CropDamageInput = {
  width: number | null | undefined
  height: number | null | undefined
  /** Logos render `object-contain` and are never cropped — see below. */
  isLogo?: boolean
  /** Aspect ratio of the box the image renders into. Defaults to the hero box. */
  targetRatio?: number
}

/**
 * Damage in [0, 1] — 0 means the image survives the crop intact, 1 means it is
 * destroyed.
 */
export function cropDamage(input: CropDamageInput): number {
  const { width, height, isLogo = false, targetRatio = HERO_TARGET_RATIO } = input

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

  // Fraction of the source area that survives a cover crop, and the damage as
  // its complement. Symmetric in a/t: the shorter ratio over the longer one is
  // the same whether the source is too tall or too wide, and only one axis is
  // ever cut. For a finite, positive `targetRatio` that also bounds the result
  // in [0, 1) without a clamp: `visible` is in (0, 1], so `1 - visible` cannot
  // leave the range. Nothing here enforces that precondition — the type says
  // `targetRatio?: number` — and outside it the bound does not hold (0 returns
  // 1, -1 returns 2). No guard, deliberately: every caller passes
  // `HERO_TARGET_RATIO`, and `cropDamagePenalty` clamps the scaled result
  // anyway.
  return 1 - Math.min(a, t) / Math.max(a, t)
}
