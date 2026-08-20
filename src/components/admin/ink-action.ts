/**
 * The ink fill for the one primary action on an admin screen.
 *
 * Admin is nothing but interaction. Public surfaces can afford an accent fill
 * because an accent-filled control is the ONE thing on the page asking to be
 * pressed; an admin queue has a decision in every row, so the same treatment
 * paints the screen indigo and the accent stops meaning anything. Admin fills
 * with ink and keeps the accent for links and focus rings.
 *
 * Composed on top of `variant="secondary"` rather than added as a fifth button
 * variant. `secondary` is already the ink outline, so this is the smallest
 * possible delta — and tailwind-merge understands background, border and text
 * colour groups, so the override resolves deterministically instead of
 * depending on CSS source order the way a font-family override would.
 *
 * ```tsx
 * <Button variant="secondary" className={inkActionClassName}>Approve</Button>
 * ```
 *
 * Ceiling: if admin ever needs a second filled weight, that is a real variant
 * in `src/components/ui/button.tsx`, not a second constant here.
 */
export const inkActionClassName =
  "border-transparent bg-ink text-on-ink hover:bg-ink/90";
