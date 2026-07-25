"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { submitCorrectionAction } from "@/lib/actions/brand-corrections";
import type { CorrectionField } from "@/lib/services/brand-corrections";
import {
  categoryLabel,
  PRODUCT_TYPE_CATEGORIES,
} from "@/lib/taxonomy/ontology";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SubmitButton } from "@/components/ui/submit-button";

const PRICE_OPTIONS = [
  { value: "1", prefix: "$", labelKey: "fieldPriceRangeBudget" },
  { value: "2", prefix: "$$", labelKey: "fieldPriceRangeMidRange" },
  { value: "3", prefix: "$$$", labelKey: "fieldPriceRangePremium" },
] as const;

export type CorrectionSheetValue = number | string | string[] | null;

export type CorrectionSheetProps = {
  brandId: string;
  brandSlug: string;
  field: CorrectionField;
  currentValue: CorrectionSheetValue;
  categorySlug?: string;
};

function initialSelection(
  field: CorrectionField,
  currentValue: CorrectionSheetValue,
): string {
  if (field === "price_range" && typeof currentValue === "number") {
    return String(currentValue);
  }
  if (field === "product_type" && typeof currentValue === "string") {
    return currentValue;
  }
  return "";
}

export function CorrectionSheet({
  brandId,
  field,
  currentValue,
}: CorrectionSheetProps) {
  const locale = useLocale();
  const tEdit = useTranslations("dashboard.edit");
  const tEvidence = useTranslations("brandDetail.evidence");
  const tReport = useTranslations("brandDetail.report");
  const tChannelDialog = useTranslations("brandDetail.channels.dialog");
  const selectId = useId();
  const originalSelection = initialSelection(field, currentValue);
  const selectionKey = `${field}:${originalSelection}`;
  const [selectionState, setSelectionState] = useState({
    key: selectionKey,
    value: originalSelection,
  });
  const [open, setOpen] = useState(true);
  const [isPending, startTransition] = useTransition();
  const selection =
    selectionState.key === selectionKey
      ? selectionState.value
      : originalSelection;

  const isSupportedField = field === "price_range" || field === "product_type";
  const hasChanged = isSupportedField && selection !== originalSelection;
  const title =
    field === "product_type"
      ? tEdit("fieldCategory")
      : field === "price_range"
        ? tEdit("fieldPriceRange")
        : tEdit("fieldProductTags");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasChanged || isPending) return;

    const proposedValue =
      field === "price_range" ? Number(selection) : selection;
    startTransition(async () => {
      try {
        const result = await submitCorrectionAction({
          brandId,
          field,
          proposedValue,
        });

        if (result.ok) {
          toast.success(tChannelDialog("success"));
          setOpen(false);
          return;
        }

        toast.error(
          result.error === "rate_limited"
            ? tReport("errors.rateLimited")
            : tEvidence("errors.unknown"),
        );
      } catch {
        toast.error(tEvidence("errors.unknown"));
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        className="max-h-dvh overflow-y-auto border-border bg-card shadow-none sm:mx-auto sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border bg-card pr-16">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <form className="flex flex-col" onSubmit={handleSubmit}>
          {field === "price_range" && (
            <div className="space-y-2 p-4">
              <Label htmlFor={selectId}>{title}</Label>
              <NativeSelect
                id={selectId}
                aria-label={title}
                value={selection}
                onChange={(event) =>
                  setSelectionState({
                    key: selectionKey,
                    value: event.target.value,
                  })
                }
                className="bg-card focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PRICE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.prefix} · {tEdit(option.labelKey)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          {field === "product_type" && (
            <div className="space-y-2 p-4">
              <Label htmlFor={selectId}>{title}</Label>
              <NativeSelect
                id={selectId}
                aria-label={title}
                value={selection}
                onChange={(event) =>
                  setSelectionState({
                    key: selectionKey,
                    value: event.target.value,
                  })
                }
                className="bg-card focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                {PRODUCT_TYPE_CATEGORIES.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {categoryLabel(item, locale)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          <SheetFooter className="gap-3 border-t border-border bg-card sm:flex-row sm:items-center sm:justify-between">
            <p className="type-caption sm:max-w-xs">
              {tEvidence("description")}
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
                className="focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
              >
                {tEdit("cancel")}
              </Button>
              <SubmitButton
                isSubmitting={isPending}
                idleLabel={tChannelDialog("submit")}
                submittingLabel={tEvidence("submitting")}
                disabled={!hasChanged || isPending}
                className="focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
                data-ph-no-autocapture
              />
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
