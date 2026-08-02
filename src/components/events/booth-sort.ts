/**
 * Booth-number ordering for an event lineup.
 *
 * Extracted as a pure module (same shape as `event-date.ts`) because the rule
 * it encodes is the entire reason the sort exists and is worth testing on its
 * own: a plain string compare puts `K1-011-05` before `K1-004` and `K1-10`
 * before `K1-4`, which is precisely the confusion a visitor standing in the
 * hall is trying to resolve. Booth codes in this dataset interleave letters and
 * numbers — `K1-004`, `K1-011-05`, `K2-010`, `S-007` — so the only ordering
 * that reads correctly on the floor compares the numeric runs as numbers.
 */

/**
 * Splits a booth code into alternating alphabetic and numeric runs:
 * `'K1-011-05'` becomes `['K', '1', '-', '011', '-', '05']`.
 *
 * `\D+` (not `[A-Z]+`) so a separator, a space, or a CJK character lands in a
 * run instead of being dropped — a dropped character would make two different
 * booths compare equal.
 */
function splitRuns(value: string): string[] {
  return value.match(/\d+|\D+/g) ?? []
}

function isNumericRun(run: string): boolean {
  return run.charCodeAt(0) >= 48 && run.charCodeAt(0) <= 57
}

/**
 * Compares two booth codes in natural order. Safe to hand `null`, `undefined`,
 * or `''`: an entry without a booth sorts LAST, never first. Sorting the
 * unknowns to the top would bury the wayfinding list the sort was requested
 * for under the entries that cannot be walked to.
 */
export function compareBoothNumbers(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = (left ?? '').trim()
  const b = (right ?? '').trim()

  if (!a || !b) {
    if (!a && !b) return 0
    return a ? -1 : 1
  }

  // Case-folded once, up front: booth codes are authored in mixed case across
  // sources, and `'k1'` and `'K1'` are the same booth to a reader.
  const aRuns = splitRuns(a.toUpperCase())
  const bRuns = splitRuns(b.toUpperCase())
  const shared = Math.min(aRuns.length, bRuns.length)

  for (let index = 0; index < shared; index += 1) {
    const aRun = aRuns[index]
    const bRun = bRuns[index]
    const aIsNumeric = isNumericRun(aRun)
    const bIsNumeric = isNumericRun(bRun)

    if (aIsNumeric && bIsNumeric) {
      const difference = Number(aRun) - Number(bRun)
      if (difference !== 0) return difference
      // Equal as numbers but possibly different as text (`'004'` vs `'4'`).
      // Deliberately falls through to the next run rather than ordering on
      // zero padding, which carries no meaning on the floor.
      continue
    }

    if (aIsNumeric !== bIsNumeric) {
      // A numeric run outranks an alphabetic one at the same position, so
      // `K1-2` precedes `K1-A`.
      return aIsNumeric ? -1 : 1
    }

    if (aRun !== bRun) return aRun < bRun ? -1 : 1
  }

  // Everything shared is equal, so the shorter code wins: `K1-011` before
  // `K1-011-05`, which is also how the booths are laid out (the sub-booth sits
  // inside the parent stand).
  return aRuns.length - bRuns.length
}
