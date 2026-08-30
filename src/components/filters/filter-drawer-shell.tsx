"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type FilterDrawerShellProps = {
  triggerLabel: string;
  title: string;
  showResultsLabel: string;
  clearAllLabel: string;
  onClearAll: () => void;
  children: ReactNode;
};

export function FilterDrawerShell({
  triggerLabel,
  title,
  showResultsLabel,
  clearAllLabel,
  onClearAll,
  children,
}: FilterDrawerShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="secondary"
            size="large"
            className="gap-2 lg:hidden"
          />
        }
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {triggerLabel}
      </SheetTrigger>
      <SheetContent
        side="left"
        size="panel"
        className="gap-0 p-0"
        showCloseButton
      >
        <SheetHeader className="border-b border-rule">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody>{children}</SheetBody>
        <SheetFooter>
          <Button type="button" width="full" onClick={() => setOpen(false)}>
            {showResultsLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="large"
            onClick={() => {
              onClearAll();
              setOpen(false);
            }}
            className="mx-auto type-body-sm underline-offset-2 hover:text-ink hover:underline"
            data-ph-no-autocapture
          >
            {clearAllLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
