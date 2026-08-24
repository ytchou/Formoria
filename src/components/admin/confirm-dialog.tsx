"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  confirmLabel: string;
  variant?: "primary" | "destructive";
  confirmText?: string;
  isPending?: boolean;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel,
  variant = "primary",
  confirmText,
  isPending = false,
}: ConfirmDialogProps) {
  const t = useTranslations("admin.common");
  const [inputValue, setInputValue] = useState("");
  const confirmationInputRef = useRef<HTMLInputElement>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setInputValue("");
    onOpenChange(nextOpen);
  }

  const isConfirmDisabled =
    isPending || (confirmText != null && inputValue !== confirmText);

  const isDestructive = variant === "destructive";

  return (
    <AlertDialog
      open={open}
      onOpenChange={handleOpenChange}
      destructive={isDestructive}
    >
      <AlertDialogContent
        {...(confirmText != null ? { initialFocus: confirmationInputRef } : {})}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>

        <AlertDialogBody className="space-y-4">
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {confirmText != null && (
            <div className="px-1">
              <Input
                ref={confirmationInputRef}
                placeholder={t("confirmPlaceholder", { value: confirmText })}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
            </div>
          )}
        </AlertDialogBody>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          {/* The `variant` styles the button; the slot is what the footer's
              destructive outline selector can actually see, since `Button`
              emits no attribute carrying its variant. */}
          <Button
            variant={variant}
            data-slot={isDestructive ? "dialog-destructive" : undefined}
            onClick={onConfirm}
            disabled={isConfirmDisabled}
          >
            {isPending ? t("processing") : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
