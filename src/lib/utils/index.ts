import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Fisher–Yates, returning a NEW array: callers pass lists they do not own
 * (service results, props), and shuffling one in place would reorder it for
 * everything else holding the same reference.
 *
 * `random` is injectable so a caller's ordering can be asserted with a stubbed
 * generator instead of a statistical guess about `Math.random`.
 */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = result[i]
    result[i] = result[j]
    result[j] = swap
  }
  return result
}
