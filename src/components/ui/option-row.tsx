'use client'

import { cn } from '@/lib/utils'

/**
 * AN OPTION ROW IS NOT A BUTTON.
 *
 * A button is one line of text at a fixed height — 44px, or 48px for `large`,
 * with 36px reserved for chips. An option row is a card-shaped CHOICE: a
 * title, often a description under it, an optional leading icon and an
 * optional trailing affordance, all of which wrap. Its height is whatever its
 * content needs.
 *
 * Three call sites used to express that by taking a `<Button>` and undoing its
 * geometry — `h-auto min-h-14`, `h-auto min-h-16`, plus `w-full justify-start
 * gap-3 px-4 py-3 text-left whitespace-normal`. That is six overrides against
 * four cva axes to reach a shape the axes never described, and it is why the
 * geometry drifted between the two rows that sit in the same dialog. The row
 * therefore renders its own `<button>` and never goes through `buttonVariants`:
 * a shape that has to cancel most of a component's definition is a different
 * component.
 *
 * What it DOES borrow from `button.tsx`, deliberately and by copy, is the
 * interaction surface a control owes the user: the drawn accent focus ring
 * that replaces `outline-none`, the disabled treatment, and the `secondary`
 * ink-outline resting state. Those are system decisions, not button geometry.
 */

/**
 * 56px. NOT a height — a floor.
 *
 * A single-line row at `py-3` is 44px, which clears the touch minimum but
 * reads as a button in a stack of cards. The floor buys the card rhythm; every
 * row past one line simply grows past it, which is why this is `min-h-*` and
 * why no caller may set a height.
 */
const optionRowBaseClasses = cn(
  'group/option-row flex min-h-14 w-full items-center gap-3 rounded-[4px] border bg-clip-padding px-4 py-3 text-left',
  'font-hei text-sm font-medium transition-[background-color,border-color,color] outline-none select-none',
  // The visible replacement for `outline-none` — same ring, offset and offset
  // colour as every other control in the system.
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground',
  'disabled:pointer-events-none disabled:opacity-50',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
)

/** Resting state: an ink outline over nothing, matching `secondary`. */
const optionRowRestingClasses = 'border-rule bg-transparent text-ink hover:bg-surface'

/**
 * Selected state. The accent tint is restated at hover scope: twMerge keys a
 * hover-variant class separately from an unmodified one, so `hover:bg-surface`
 * above would otherwise repaint a selected row as unselected on hover.
 */
const optionRowSelectedClasses = cn(
  'border-accent bg-accent/10 text-accent',
  'hover:border-accent hover:bg-accent/10 hover:text-accent',
)

type OptionRowProps = Omit<
  React.ComponentProps<'button'>,
  'type' | 'aria-pressed' | 'title' | 'children'
> & {
  /** Whether this option is currently chosen. Drives `aria-pressed`. */
  selected?: boolean
  /** The option's label. Carries the row's own interface type. */
  title: React.ReactNode
  /** Secondary line under the title. Omit for a single-line row. */
  description?: React.ReactNode
  /** Leading icon. Colour it at the call site if it must differ from the row. */
  icon?: React.ReactNode
  /** Trailing affordance — a check when selected, a chevron when not. */
  trailing?: React.ReactNode
}

/**
 * A selectable, card-shaped row. Always a `<button type="button">`: these are
 * choices inside a form or dialog, never navigation.
 *
 * `aria-pressed` rather than `role="radio"` — the existing groups are labelled
 * `role="group"` and allow the current choice to be replaced but not cleared
 * by a second click, which is what `aria-pressed` already described. Swapping
 * in a radiogroup would change keyboard navigation as a side effect of a
 * styling refactor.
 */
function OptionRow({
  selected = false,
  title,
  description,
  icon,
  trailing,
  className,
  ...props
}: OptionRowProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        optionRowBaseClasses,
        selected ? optionRowSelectedClasses : optionRowRestingClasses,
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block">{title}</span>
        {description ? (
          <span className="mt-0.5 block type-body-sm">{description}</span>
        ) : null}
      </span>
      {trailing}
    </button>
  )
}

export { OptionRow }
