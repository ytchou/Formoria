"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { textStyles } from "./text-styles";
import { type DialogSize } from "./dialog";

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
}

/**
 * THE WIDTH VOCABULARY IS ONE LIST, DECLARED IN `dialog.tsx`. It used to be
 * re-spelled here by hand, which meant a fifth name was two edits and stayed
 * correct only until someone made one of them. A sheet takes a width only on
 * the left and right sides, where it is a vertical panel. Compact, panel and
 * form cap every viewport; wide stays uncapped below `sm` and gains its 72rem
 * cap above it. `Record<DialogSize, …>` makes a new name a type error here
 * until both viewport branches are answered.
 */
const sheetSizeClasses: Record<DialogSize, string> = {
  compact: "data-[side=left]:overlay-compact data-[side=right]:overlay-compact",
  panel: "data-[side=left]:overlay-panel data-[side=right]:overlay-panel",
  form: "data-[side=left]:overlay-form data-[side=right]:overlay-form",
  wide: "data-[side=left]:max-w-none data-[side=right]:max-w-none data-[side=left]:sm:overlay-wide data-[side=right]:sm:overlay-wide",
};

function SheetContent({
  className,
  children,
  side = "right",
  size = "panel",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
  size?: DialogSize;
  showCloseButton?: boolean;
}) {
  const t = useTranslations("common");

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        data-size={size}
        className={cn(
          "fixed z-50 flex flex-col gap-4 border-rule bg-ground bg-clip-padding text-sm text-ink transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-[86vw] data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-[86vw] data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem]",
          sheetSizeClasses[size],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon"
              />
            }
          >
            <XIcon />
            <span className="sr-only">{t("closeDialog")}</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      // THE CLOSE-BUTTON GUTTER LIVES HERE, exactly as it does in
      // `DialogHeader`: the number is derived from the close button's own box
      // (`size="icon"` is 2.75rem, inset 0.5rem from the top and right), and
      // the primitive is the only place that knows it. Without it a long title
      // runs under the X and the X's hit area lands on the title text — which
      // `brand-detail-sheet.tsx` had been compensating for with its own copy of
      // the number.
      className={cn("flex flex-col gap-0.5 p-4 pr-14 sm:pr-16", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex flex-col gap-2 border-t border-rule bg-surface p-4",
        className,
      )}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-h-0 flex-1 overflow-y-auto p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(textStyles({ variant: "cardTitle" }), className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetBody,
  SheetHeader,
  SheetFooter,
  SheetTitle,
};
