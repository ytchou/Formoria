import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * EVERY CUSTOM WIDTH NAME FROM `globals.css`, TAUGHT TO tailwind-merge.
 *
 * tailwind-merge resolves a conflict by class GROUP, and it only knows the
 * groups it ships with — a custom `@utility` is an unknown string it keeps
 * verbatim. Two of them both setting `max-width` therefore survive together on
 * one element at equal specificity, and the winner is whichever rule Tailwind
 * happened to emit last: an order no call site can read and no test can pin.
 *
 * THE FIVE COMPONENT SIZES were registered first. The moment `DialogContent`
 * carried `sm:overlay-panel` instead of Tailwind's own small-screen cap, the
 * six dialogs that pass `sm:max-w-lg` would have kept BOTH widths. Registering
 * the names is what keeps a call-site override doing what it did when the base
 * was a built-in.
 *
 * THE THREE PAGE MEASURES ARE HERE FOR THE SAME REASON — corrected. This block
 * used to say they were deliberately absent because no call site overrides its
 * page width. That was never true of this codebase: `PageShell` merges an
 * arbitrary caller `className` over its own measure, and
 * `createStoryComponentMap` merges MDX-supplied classes over `prose-measure`.
 * Unregistered, `cn(shellStyles({ measure: "page" }), "max-w-none")` kept both
 * caps, and `cn(shellStyles({ measure: "page" }), "prose-measure")` produced
 * the two `*-measure` classes on one element that `globals.css` forbids
 * outright. The four component names beside them resolved correctly, so the
 * asymmetry was invisible to whoever wrote the offending line.
 *
 * A name added to `globals.css` and not added here does not fail; it silently
 * stops being overridable, which is why the two lists name each other in both
 * files.
 *
 * Tailwind's own built-in cap above is described rather than typed: Tailwind
 * scans comments as content, so a whole class name written here emits a real
 * CSS rule nothing uses.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "max-w": [
        // The three page measures — `PAGE_MEASURES` in `page-shell.tsx`.
        "page-measure",
        "form-measure",
        "prose-measure",
        // The five component sizes — the `overlay-*` block in `globals.css`.
        // `overlay-tokens.test.ts` pins the two lists to the same set, so a
        // name added there and not here fails rather than silently stops
        // being overridable.
        "overlay-compact",
        "overlay-panel",
        "overlay-form",
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
