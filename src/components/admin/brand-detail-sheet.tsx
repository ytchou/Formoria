"use client";

import type { ReactNode } from "react";
import {
  Sheet,
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
        className="gap-0 p-0 data-[side=right]:w-[calc(100vw-1rem)] data-[side=right]:max-w-none data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-6xl"
      >
        <SheetHeader className="border-b p-5 pr-16">
          <SheetTitle>{title}</SheetTitle>
          {metadata}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function isInteractiveTableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, a, input, select, textarea, [role='checkbox'], [role='combobox']",
      ),
    )
  );
}
