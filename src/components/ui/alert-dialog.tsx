"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { textStyles } from "./text-styles";

/**
 * The shared overlay width axis. `compact` is one sentence and two buttons;
 * `panel` is the default confirmation; `form` is a dialog the reader fills in;
 * `wide` is a workspace. The utilities themselves live in `globals.css`.
 */
type AlertDialogSize = "compact" | "panel" | "form" | "wide";

type AlertDialogContextValue = {
  destructive: boolean;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
};

const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(
  null,
);

/**
 * `destructive` is the one-way-door switch. It moves initial focus onto Cancel
 * and refuses every dismissal that is not an explicit button press, so the
 * cheapest keystroke can never be the one that deletes something. It defaults
 * OFF: an ordinary confirmation should still be escapable.
 */
function AlertDialog({
  destructive = false,
  onOpenChange,
  ...props
}: AlertDialogPrimitive.Root.Props & { destructive?: boolean }) {
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);

  const handleOpenChange = React.useCallback(
    (open: boolean, details: AlertDialogPrimitive.Root.ChangeEventDetails) => {
      // Base UI already refuses outside presses for every alert dialog (its
      // Root hard-codes `disablePointerDismissal`), so `outside-press` never
      // reaches here in practice — it is listed to keep the intent readable and
      // to survive a future Base UI that relaxes that default.
      if (
        destructive &&
        !open &&
        (details.reason === "escape-key" || details.reason === "outside-press")
      ) {
        details.cancel();
        return;
      }

      onOpenChange?.(open, details);
    },
    [destructive, onOpenChange],
  );

  const value = React.useMemo<AlertDialogContextValue>(
    () => ({ destructive, cancelRef }),
    [destructive],
  );

  return (
    <AlertDialogContext.Provider value={value}>
      <AlertDialogPrimitive.Root
        data-slot="alert-dialog"
        onOpenChange={handleOpenChange}
        {...props}
      />
    </AlertDialogContext.Provider>
  );
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 transition-opacity duration-150 ease-out supports-backdrop-filter:backdrop-blur-xs data-starting-style:opacity-0 data-ending-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  size = "panel",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: AlertDialogSize;
}) {
  const context = React.useContext(AlertDialogContext);

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        // A ref, not `true`: Base UI resolves it in a microtask after the
        // children have mounted, so the Cancel button exists by then.
        initialFocus={context?.destructive ? context.cancelRef : undefined}
        className={cn(
          // WIDTH IS SPELLED WITH THE `data-[size=…]` PREFIX ON PURPOSE. A bare
          // `overlay-panel` would sit in the same tailwind-merge `max-w` group
          // as a call site's own `max-w-*` and lose to it silently; the data
          // prefix keeps the two distinguishable so a call site has to opt out
          // deliberately (`!max-w-…`) rather than by accident.
          //
          // Below `sm` the panel is a full-width bottom sheet capped at 85dvh,
          // which leaves a strip of backdrop tappable above it. From `sm` up it
          // is a centred card — centred with `inset-0 m-auto` rather than a
          // translate, so the transform axis stays free for the motion below.
          "group/alert-dialog-content fixed inset-x-0 bottom-0 z-50 grid max-h-[85dvh] w-full grid-rows-[auto_minmax(0,1fr)_auto] rounded-t-surface border border-rule bg-ground text-ink outline-none",
          "sm:inset-0 sm:m-auto sm:h-fit sm:w-[calc(100%-2rem)] sm:max-h-[calc(100dvh-4rem)] sm:rounded-surface",
          "data-[size=compact]:sm:overlay-compact data-[size=panel]:sm:overlay-panel data-[size=form]:sm:overlay-form data-[size=wide]:sm:overlay-wide",
          // Base UI transition states, not `animate-in`/`animate-out`: the
          // popup stays mounted through the exit so the sheet can slide back
          // down. `globals.css` caps every transition at 0.01ms under
          // `prefers-reduced-motion: reduce`, so there is no local branch.
          "transition-[opacity,transform,translate] duration-150 ease-out",
          "data-starting-style:translate-y-8 data-starting-style:opacity-0 data-ending-style:translate-y-8 data-ending-style:opacity-0",
          "sm:data-starting-style:translate-y-0 sm:data-starting-style:scale-95 sm:data-ending-style:translate-y-0 sm:data-ending-style:scale-95",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid place-items-center gap-1.5 border-b border-rule p-4 text-center sm:place-items-start sm:text-left",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-body"
      className={cn("min-h-0 overflow-y-auto p-4", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 rounded-b-surface border-t border-rule bg-surface p-4 sm:flex-row sm:justify-end",
        // Same slot-scoped destructive outline as `DialogFooter`, and the same
        // reason: `Button` exposes no variant attribute, and `*:` plus an
        // explicit slot keeps the outline off the Cancel button beside it.
        "*:data-[slot=dialog-destructive]:border-danger *:data-[slot=dialog-destructive]:text-danger",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(textStyles({ variant: "cardTitle" }), className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        textStyles({ variant: "cardDescription" }),
        "text-balance md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  variant = "secondary",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  const context = React.useContext(AlertDialogContext);

  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      ref={context?.cancelRef}
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
};
