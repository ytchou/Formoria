import { cn } from "@/lib/utils"

/**
 * A real `<select>`. No listbox shell, no portal, no roving tabindex — the
 * platform control is already keyboard-complete and renders as the native
 * picker on touch, which is the whole reason this exists instead of a
 * custom one.
 *
 * Matched to `Input`: 44px tall, 4px radius, rule border, and a drawn 2px
 * accent ring on `:focus-visible` standing in for the suppressed outline. A
 * select that sits a step shorter than the input beside it is the drift a
 * shared token set exists to prevent.
 *
 * It does NOT read `useFormFieldContext()` the way `Input` does, so a caller
 * inside a `FormField` wires `aria-invalid` and `aria-describedby` itself.
 * Deliberate: reading the context would make this a client component, and it
 * is imported by server-rendered admin filters that have no other reason to
 * cross the boundary.
 */
function NativeSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-11 w-full min-w-0 rounded-control border border-rule bg-transparent px-3.5 py-2 font-hei text-base text-ink transition-colors outline-none",
        "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-50",
        "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/30",
        "md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
