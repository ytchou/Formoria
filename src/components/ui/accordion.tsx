import type { ComponentProps, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The shared disclosure accordion. Every FAQ and every collapsible group on the
 * site renders through this file.
 *
 * VISUAL ANATOMY IS ADAPTED FROM FLOWBITE'S DEFAULT ACCORDION
 * (https://flowbite.com/docs/components/accordion/): a boxed container, a
 * full-width header row, a hairline under each row, a hover fill, a chevron
 * that rotates on open, and a panel carrying its own hairline. What does NOT
 * come across is Flowbite's palette (cool grays against a warm-paper site) or
 * its `shadow-xs` — elevation here is the border, never a shadow.
 *
 * NATIVE <details>/<summary>, NEVER A SCRIPTED PANEL. The answer ships in the
 * server HTML whether or not the panel is open, which is the only reason a
 * crawler or an answer engine can read it. A JS accordion renders an empty
 * shell to everything that does not run scripts. This is also why the file
 * carries no 'use client': it must render on the server, and one e2e spec
 * parses the raw server HTML to prove it does.
 *
 * `...props` lands on the <details> element itself, deliberately. Three
 * separate consumers reach for that node directly:
 *   - `id`   — OpenTargetDetails opens the element matching location.hash, and
 *              guards on `instanceof HTMLDetailsElement`. An id on a wrapper
 *              silently kills every deep link.
 *   - `data-*` — the only handle e2e has on a stockist region group.
 *   - `onToggle` — the toggle event does not bubble, so a handler anywhere
 *              else never fires.
 * Anything that moves those onto a wrapper breaks production, not just tests.
 */
const accordionStyles = cva("", {
  variants: {
    variant: {
      /* Separated cards: each item is its own bordered block, with a gap
         between them. The stack is deliberately NOT one continuous box —
         a shared-border table reads as a grid of rows rather than a set of
         things you can open. */
      boxed: "space-y-3",
      /* No gaps: items sit flush against each other in one column. */
      flush: "space-y-0",
    },
  },
  defaultVariants: {
    variant: "boxed",
  },
});

type AccordionProps = ComponentProps<"div"> & VariantProps<typeof accordionStyles>;

function Accordion({ className, variant, ...props }: AccordionProps) {
  return (
    <div
      data-slot="accordion"
      className={cn(accordionStyles({ variant }), className)}
      {...props}
    />
  );
}

type AccordionItemProps = Omit<ComponentProps<"details">, "title"> & {
  /**
   * ReactNode rather than string: the stockist list passes a real <h3> so the
   * region heading stays inside <summary>, where clicking it toggles the row.
   * Named `title` shadows the HTML title attribute, hence the Omit above.
   */
  title: ReactNode;
  titleClassName?: string;
  panelClassName?: string;
};

function AccordionItem({
  title,
  titleClassName,
  panelClassName,
  className,
  children,
  ...props
}: AccordionItemProps) {
  return (
    <details
      data-slot="accordion-item"
      className={cn(
        /* 8px, softer than DESIGN.md's 2-3px surface radius. Deliberate and
           scoped to this component: the separated-card accordion reads as a
           set of pressable blocks, and a near-square corner made them look
           like table rows. */
        "group overflow-hidden rounded-[8px] border border-rule",
        className,
      )}
      {...props}
    >
      {/* The row's padding lives on <summary>, the interactive element, so the
          whole visual row is the hit target (~56px, over the 44px minimum) and
          the focus ring wraps it rather than the text alone. The ring is inset
          because the item clips an outset one.

          The open row carries a deeper fill than the hover fill, so "this is
          the one I am reading" survives the mouse moving away. `group-open`
          is repeated on the hover variant because a bare `hover:` would
          otherwise lighten the open row back to the hover tone. */}
      <summary
        className={cn(
          "flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-4",
          "type-body text-ink transition-colors hover:bg-surface",
          "group-open:bg-surface-deep group-open:hover:bg-surface-deep",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
          "[&::-webkit-details-marker]:hidden",
          titleClassName,
        )}
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:duration-[0.01ms]"
        />
      </summary>
      <div
        className={cn(
          "border-t border-rule px-4 py-4 type-body-sm text-ink-soft",
          panelClassName,
        )}
      >
        {children}
      </div>
    </details>
  );
}

export { Accordion, AccordionItem };
