/**
 * THE MEDIA HOVER AND PRESS GRAMMAR — one recipe for every card and control.
 *
 * Five card components carried four hover recipes (EL-05): Tailwind's default
 * easing instead of `--ease-settle`, a 1.02 scale on one card and 1.03 on the
 * rest, and a scale with no reduced-motion guard on two of them. Nothing gave
 * press feedback at all (EL-06). The values below are DESIGN.md §7b; the class
 * strings are the only place they are spelled as Tailwind.
 *
 * Every transform is behind `motion-safe:`. The global reduced-motion block
 * only zeroes durations, so an unguarded scale still jumps to 1.03 instantly;
 * `motion-safe:` removes it. Colour cues stay unguarded: they are the state
 * signal that remains when motion is off.
 *
 * Tailwind reads these literals at build time, so they stay whole strings —
 * never assembled from the numbers below.
 */

/*
 * The values: image hover scale 1.00→1.03 over 300ms `--ease-settle`, image
 * only (§7b); colour 150ms `--ease-settle` (§7b); control press scale 0.96
 * over 150ms ease-out, cards never scale on press (not yet a §7b row —
 * DEV-2022 flags the amendment).
 */

/** The image inside a `group` card link. Captions never move. */
export const mediaHoverImage =
  "transition-[scale] duration-300 ease-(--ease-settle) motion-safe:group-hover:scale-[1.03]";

/**
 * A card title inside a `group` link. Accent on hover is interaction (§2);
 * `group-active` is the card's press cue — colour, not scale.
 */
export const mediaHoverTitle =
  "transition-colors duration-150 ease-(--ease-settle) group-hover:text-accent group-active:text-accent";

/**
 * Press on a control. Pair with a `transition-[…,scale]` list that already
 * names the control's colour properties.
 */
export const controlPress = "motion-safe:active:not-disabled:scale-[0.96]";
