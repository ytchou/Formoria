/**
 * The interaction surface every control shares, in ONE place.
 *
 * `button.tsx` and `tabs.tsx` each spelled these out independently, and they
 * had already drifted: the button drew a 2px accent ring offset off the
 * control, while the tab drew a 3px `ring-ring/50` plus a border and an
 * outline — three focus treatments for one idea. A focus ring is a property of
 * the design system, not of a component, so it lives here and both import it.
 *
 * These are strings, not a cva: they are composed INTO other cva bases rather
 * than being a variant of anything.
 */

/**
 * The visible replacement for `outline-none`: a drawn 2px accent ring, offset
 * off the control so it reads on `ground` and on `surface` alike.
 * DESIGN.md:294 — "Every interactive element has a drawn focus state. Focus
 * ring is 2px accent."
 */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"

/** Non-interactive treatment, matched for pointer and for `aria-disabled`. */
export const DISABLED_STATE =
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50"

/**
 * Icons inside a control: never their own hit target, never shrunk by flex,
 * and 16px unless the caller sized them explicitly.
 */
export const CONTROL_ICON =
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
