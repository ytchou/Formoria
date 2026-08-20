import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * THE FOUR COMPONENT SIZES FROM `globals.css`, TAUGHT TO tailwind-merge.
 *
 * tailwind-merge resolves a conflict by class GROUP, and it only knows the
 * groups it ships with — a custom `@utility` is an unknown string it keeps
 * verbatim. So the moment `DialogContent` carries `sm:overlay-panel` instead
 * of `sm:max-w-sm`, the six dialogs that pass `sm:max-w-lg` would keep BOTH
 * widths, at equal specificity, with the winner decided by whichever rule
 * Tailwind happened to emit last. Registering the four names into `max-w` is
 * what keeps a call-site override doing what it did when the base was a
 * built-in.
 *
 * The three PAGE measures are deliberately absent: no call site overrides its
 * page width — `PageShell` decides it — so there is no conflict to resolve.
 * A new component size added to `globals.css` and not added here does not
 * fail; it silently stops being overridable, which is why the two lists name
 * each other in both files.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "max-w": [
        "overlay-compact",
        "overlay-panel",
        "overlay-wide",
        "content-column",
      ],
    },
  },
})

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
