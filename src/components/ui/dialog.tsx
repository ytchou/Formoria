"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { textStyles } from "./text-styles";
import { Typography } from "./typography";

/**
 * THE SIZE AXIS IS A PROP, NOT A className.
 *
 * Every one of these names is a width already declared in `globals.css`, and
 * the four cover what a dialog is FOR: a confirmation, a floating panel, a
 * form the reader fills in, a workspace. A call site that reaches past this
 * prop for its own cap is describing a fifth kind of dialog, and that is a
 * conversation about the vocabulary rather than a className.
 */
const DIALOG_SIZES = ["compact", "panel", "form", "wide"] as const;

type DialogSize = (typeof DIALOG_SIZES)[number];

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // Base UI's own enter/exit hooks rather than a keyframe pair: the
        // popup below has to interpolate a TRANSFORM that differs between the
        // phone sheet and the centred panel, which a fixed keyframe cannot
        // express. Two motion systems on one component is how a backdrop ends
        // up outliving the panel it dims. The reduced-motion kill switch is
        // global (`globals.css`), and it caps transitions as well as
        // animations, so this needs no branch of its own.
        "fixed inset-0 isolate z-50 bg-black/10 transition-opacity duration-100 supports-backdrop-filter:backdrop-blur-xs data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "form",
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  size?: DialogSize;
}) {
  const t = useTranslations("common");

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-size={size}
        className={cn(
          // TWO ROWS, NOT A FREE-FLOWING STACK. Row one is the header, row two
          // is `minmax(0, 1fr)` — a row that is ALLOWED TO BE SHORTER than its
          // content, which is the only thing that lets `DialogBody` scroll
          // instead of pushing the footer past the bottom of the screen.
          //
          // THE HEIGHT CAP IS UNPREFIXED SO A CALL SITE CAN LIFT IT. It is the
          // one class here a call site is expected to beat: the expo floor map
          // is a documented fullscreen exemption and has to reach `100dvh` on a
          // phone. Unprefixed keeps it in tailwind-merge's `max-h` group with
          // the same (empty) modifier set as a call site's own `max-h-*`, so
          // the two collapse and the call site's survives alone. `max-h-none`
          // is the case that did NOT collapse — tailwind-merge does not ship
          // `none` in its `max-h` scale — which is why `src/lib/utils` now
          // registers it. Never move this onto the `data-[size=…]` axis: that
          // would raise its specificity above any unprefixed override and bake
          // the cap in for good.
          "group/dialog-content fixed z-50 grid max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)] border border-rule bg-ground text-sm text-ink outline-none",
          // BELOW `sm` THE DIALOG IS A BOTTOM SHEET: full width, docked to the
          // bottom edge, rounded on top only. `max-h` is what keeps the
          // backdrop tappable — a sheet that reaches the top of the viewport
          // reads as a page, and leaves no way out but the close button.
          "inset-x-0 bottom-0 w-full rounded-t-surface",
          // THE GUTTER IS A WIDTH, NOT A MAX-WIDTH, and it must stay one.
          // Spelled as `max-w-[calc(100%-2rem)]` it lands in the same media
          // query as the size branches below and loses to every one of them:
          // `.data-[size=wide]:sm:overlay-wide[data-size="wide"]` carries two
          // compound selectors to the gutter's one, tailwind-merge keeps both
          // because their modifier sets differ, and the higher specificity
          // decides. A `size="wide"` dialog on a 700px window then resolved to
          // 72rem, took the full 700px, and touched both screen edges. As a
          // WIDTH it competes with nothing the size axis sets, so the panel is
          // `min(100% - 2rem, <size>)` at every name — the same shape
          // `alert-dialog.tsx` carries, for the same reason. Do not "fix" it
          // back to a max-width.
          "sm:top-1/2 sm:right-auto sm:bottom-auto sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-surface",
          // EVERY BRANCH IS PREFIXED, which reads as redundant and is not: an
          // unprefixed base width would lose to any call site that sets one,
          // in the cascade and in the tailwind-merge grouping that decides
          // whether the two even survive together. `alert-dialog.tsx` carries
          // the same shape for the same reason. All four step in at `sm`,
          // which is where `alert-dialog.tsx` steps too — one breakpoint for
          // the whole vocabulary, so a size is never also a breakpoint
          // decision. The gutter above stays the floor whenever a name is
          // wider than the viewport it lands on.
          "data-[size=compact]:sm:overlay-compact data-[size=panel]:sm:overlay-panel data-[size=form]:sm:overlay-form data-[size=wide]:sm:overlay-wide",
          // The sheet slides up; the panel fades and settles. v4 animates
          // `translate` and `scale` as separate properties, so the centring
          // transform and the entry offset do not overwrite each other.
          "transition-[opacity,translate,scale] duration-150 ease-out data-ending-style:translate-y-full data-ending-style:opacity-0 data-starting-style:translate-y-full data-starting-style:opacity-0",
          "sm:data-ending-style:translate-y-[-50%] sm:data-ending-style:scale-95 sm:data-starting-style:translate-y-[-50%] sm:data-starting-style:scale-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon"
              />
            }
          >
            <XIcon />
            {/* Names the ACTION, not the glyph. `DialogHeader` reserves the
                gutter this sits in, so the title never runs under it. */}
            <span className="sr-only">{t("closeDialog")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      // THE CLOSE-BUTTON GUTTER LIVES HERE. Three call sites used to spell it
      // as `pr-14 sm:pr-16` beside their own copy of the border, each of them
      // a number that had to be re-derived from the button's size by hand.
      className={cn(
        "flex flex-col gap-2 border-b border-rule p-4 pr-14 sm:pr-16",
        className,
      )}
      {...props}
    />
  );
}

/**
 * THE ONLY SCROLL CONTAINER IN THE DIALOG.
 *
 * `DialogContent` deliberately does not scroll: a popup that scrolls as a
 * whole takes the header and the footer with it, and the reader loses both the
 * title and the way out at exactly the moment a long form needs them. `min-h-0`
 * is the half that is easy to drop — without it a flex or grid child refuses to
 * shrink below its content and the overflow silently never engages.
 */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-h-0 flex-1 overflow-y-auto p-4", className)}
      {...props}
    />
  );
}

/**
 * A `<form>`, NOT `display: contents`.
 *
 * The form has to be a real box in the grid's second row so its own children
 * can share the row's height budget. `display: contents` removes the element
 * from layout, which works until the moment something inside it needs to
 * scroll — and it also drops the element from the accessibility tree in
 * several engines, taking the form's implicit grouping with it.
 */
function DialogForm({ className, ...props }: React.ComponentProps<"form">) {
  return (
    <form
      data-slot="dialog-form"
      className={cn("flex min-h-0 flex-col", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // NO NEGATIVE MARGINS. The footer used to pull itself out of a padded
        // popup with `-mx-4 -mb-4`, which only lined up while the popup's
        // padding was exactly that number; the padding now belongs to the
        // sections, so the footer is simply a row.
        "flex flex-col-reverse gap-2 rounded-b-surface border-t border-rule bg-surface p-4 sm:flex-row sm:justify-end",
        // THE DESTRUCTIVE OUTLINE IS SCOPED BY SLOT AND TO DIRECT CHILDREN.
        // `Button`'s own destructive variant stays borderless everywhere else
        // — a delete button in a footer is the one place the outline earns its
        // weight, and `*:` plus an explicit slot means it can never reach a
        // Cancel sitting beside it.
        "*:data-[slot=dialog-destructive]:border-danger *:data-[slot=dialog-destructive]:text-danger",
        className,
      )}
      {...props}
    >
      {/* NO CLOSE BUTTON OF ITS OWN. `DialogContent` already renders one, and
          a second would give one action two focus stops under the same name.
          The prop that used to switch it on had zero call sites. */}
      {children}
    </div>
  );
}

/**
 * THE LOADING / ERROR / EMPTY BRANCH, WHICH IS NOT A BODY.
 *
 * It never scrolls, because it never has enough content to: one message and
 * the actions that answer it. `message` covers that case; `children` is the
 * escape for the one call site whose branch is real markup. There is no `tone`
 * axis — a success state that needs an icon and a heading is markup, and
 * `children` already renders it in the same shell.
 *
 * IT ANNOUNCES ITSELF. Every branch replaces a form in place after an async
 * submit, and the button that was focused leaves the tree with it, so without a
 * live region the reader hears nothing at all. `role="status"` is the cheapest
 * rung of the house ladder (focus move > aria-describedby > role=status >
 * role=alert) that works here: the text arrives in answer to the reader's own
 * action, which is what polite announcement is for, and moving focus would cost
 * them their place for a one-sentence result. A branch that is a genuine
 * failure may pass `role="alert"` — the spread sits after the default so it
 * can.
 */
function DialogStatus({
  actions,
  children,
  className,
  message,
  ...props
}: React.ComponentProps<"div"> & {
  actions?: React.ReactNode;
  message?: React.ReactNode;
}) {
  return (
    <div
      data-slot="dialog-status"
      role="status"
      className={cn("flex min-h-0 flex-col", className)}
      {...props}
    >
      {/* `||`, NOT `??`. A branch written `{isError && <Detail />}` passes
          `false` — defined, so `??` would keep it and the status would render
          empty rather than falling through to `message`. */}
      {children || (
        <Typography variant="cardDescription" className="flex-1 p-4">
          {message}
        </Typography>
      )}
      {actions ? <DialogFooter>{actions}</DialogFooter> : null}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(textStyles({ variant: "cardTitle" }), className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        textStyles({ variant: "cardDescription" }),
        "*:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogStatus,
  DialogTitle,
  DialogTrigger,
  DIALOG_SIZES,
  type DialogSize,
};
