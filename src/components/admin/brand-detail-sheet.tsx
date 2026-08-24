"use client";

import type { ReactNode } from "react";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type BrandDetailSheetProps = {
  children: ReactNode;
  metadata?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

export function BrandDetailSheet({
  children,
  metadata,
  onOpenChange,
  open,
  title,
}: BrandDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="wide"
        className="gap-0 p-0 data-[side=right]:w-[calc(100vw-1rem)] data-[side=right]:sm:w-3/4"
      >
        {/* `border-rule`, never a bare `border-b`: Tailwind v4's preflight sets
            `border-color: currentColor` and this project declares no
            `--default-border-color`, so an unqualified border renders in ink
            and reads heavier than every other overlay header. The close-button
            gutter is deliberately absent — `SheetHeader` owns it now. */}
        <SheetHeader className="border-b border-rule p-5">
          <SheetTitle>{title}</SheetTitle>
          {metadata}
        </SheetHeader>
        <SheetBody className="p-5">{children}</SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function isInteractiveTableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, a, input, select, textarea, [role='checkbox'], [role='combobox'], [role='menuitem'], [data-slot^='dropdown-menu']",
      ),
    )
  );
}
