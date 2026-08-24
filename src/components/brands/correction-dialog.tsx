"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";

import type { OnlineStoreColumn } from "@/lib/brands/online-stores";
import type { CorrectionField } from "@/lib/services/brand-corrections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { DialogLoadingContent } from "@/components/brands/dialog-loading-content";
import type { CorrectionDialogMode } from "@/components/brands/correction-dialog-content";

// Click-gated: the field picker, the chip rows and the whole L2 vocabulary only
// reach the browser once the trigger is primed. `ssr: false` because the body
// only ever renders inside an open dialog portal — there is no server markup to
// preserve. `loading` guarantees the portal (overlay + focus trap) still mounts
// while the chunk is in flight, at the width the body will land at.
const CorrectionDialogContent = dynamic(
  () =>
    import("@/components/brands/correction-dialog-content").then(
      (m) => m.CorrectionDialogContent,
    ),
  { ssr: false, loading: () => <DialogLoadingContent size="form" /> },
);

// One row per mode keeps the trigger/title/picker copy readable as the mode set
// grows — a fourth mode is a single entry here, not another nested ternary. It
// lives in the shell because the shell renders the trigger copy; the three keys
// the body needs ride down as a prop rather than dragging this chunk back in.
const COPY_KEYS: Record<
  CorrectionDialogMode,
  {
    trigger: string;
    title: string;
    fieldPickerLabel: string;
    fieldPickerPlaceholder: string;
  }
> = {
  brandInfo: {
    trigger: "trigger",
    title: "title",
    fieldPickerLabel: "fieldPickerLabel",
    fieldPickerPlaceholder: "fieldPickerPlaceholder",
  },
  purchaseLinks: {
    trigger: "purchaseTrigger",
    title: "purchaseTitle",
    fieldPickerLabel: "purchaseFieldPickerLabel",
    fieldPickerPlaceholder: "purchaseFieldPickerPlaceholder",
  },
  socialLinks: {
    trigger: "socialTrigger",
    title: "socialTitle",
    fieldPickerLabel: "socialFieldPickerLabel",
    fieldPickerPlaceholder: "socialFieldPickerPlaceholder",
  },
};

export type CorrectionDialogProps = {
  brandId: string;
  brandSlug: string;
  mode?: CorrectionDialogMode;
  categorySlug?: string | null;
  subcategories?: string[];
  purchaseLinks?: Record<OnlineStoreColumn, string | null>;
  socialInstagram?: string | null;
  socialThreads?: string | null;
  socialFacebook?: string | null;
};

export function CorrectionDialog({
  brandId,
  brandSlug,
  mode = "brandInfo",
  categorySlug = null,
  subcategories = [],
  purchaseLinks = {} as Record<OnlineStoreColumn, string | null>,
  socialInstagram = null,
  socialThreads = null,
  socialFacebook = null,
}: CorrectionDialogProps) {
  const tCorrection = useTranslations("brandDetail.correction");
  const copy = COPY_KEYS[mode];
  // Once primed the content stays mounted, so its selection state survives
  // close/reopen exactly as it did when the body was statically imported.
  const [primed, setPrimed] = useState(false);
  const [open, setOpen] = useState(false);
  // Lives here rather than in the body so the close handler can reset the
  // picker without the body chunk being involved. Starts empty so the dialog
  // opens on the picker alone — no value control is shown until the
  // contributor says what they are correcting.
  const [field, setField] = useState<CorrectionField | "">("");
  const prime = () => setPrimed(true);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Every open starts at the picker, not at whatever was picked last time.
    if (!next) setField("");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        onPointerEnter={prime}
        onPointerDown={prime}
        onFocus={prime}
        onClick={prime}
        render={
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="relative gap-1.5 px-1 type-metadata text-accent underline-offset-4 after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] hover:bg-transparent hover:text-accent/80 hover:underline focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
        }
      >
        <Pencil aria-hidden="true" />
        {tCorrection(copy.trigger)}
      </DialogTrigger>
      {primed && (
        <CorrectionDialogContent
          brandId={brandId}
          brandSlug={brandSlug}
          mode={mode}
          copy={copy}
          field={field}
          setField={setField}
          onOpenChange={handleOpenChange}
          categorySlug={categorySlug}
          subcategories={subcategories}
          purchaseLinks={purchaseLinks}
          socialInstagram={socialInstagram}
          socialThreads={socialThreads}
          socialFacebook={socialFacebook}
        />
      )}
    </Dialog>
  );
}
