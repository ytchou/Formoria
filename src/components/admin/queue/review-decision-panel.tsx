"use client";

import { useId, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ReviewNotesPolicy =
  | "none"
  | "optional"
  | "requiredOnReject"
  | "required";
export type ReviewConfirmMode = "none" | "inline-two-step" | "dialog";

type ReviewDecision = "approve" | "reject";

export function ReviewDecisionPanel(props: {
  onApprove: (notes: string) => void;
  onReject: (notes: string) => void;
  approveLabel?: string;
  rejectLabel?: string;
  notesPolicy?: ReviewNotesPolicy;
  notesLabel?: string;
  notesPlaceholder?: string;
  confirmMode?: ReviewConfirmMode;
  confirm?: {
    title: string;
    description: string;
    approveLabel?: string;
    rejectLabel?: string;
    confirmText?: string;
  };
  inlineConfirmLabel?: (decision: ReviewDecision) => string;
  eligible?: boolean;
  blocker?: ReactNode;
  isPending?: boolean;
  error?: string | null;
  extraActions?: ReactNode;
}): React.JSX.Element {
  const {
    onApprove,
    onReject,
    approveLabel = "Approve",
    rejectLabel = "Reject",
    notesPolicy = "optional",
    notesLabel = "Review notes",
    notesPlaceholder,
    confirmMode = "none",
    confirm,
    inlineConfirmLabel,
    eligible = true,
    blocker,
    isPending = false,
    error,
    extraActions,
  } = props;
  const notesId = useId();
  const [notes, setNotes] = useState("");
  const [armedDecision, setArmedDecision] =
    useState<ReviewDecision | null>(null);
  const [dialogDecision, setDialogDecision] =
    useState<ReviewDecision | null>(null);

  const notesBlank = notes.trim().length === 0;
  const approveDisabled =
    isPending || !eligible || (notesPolicy === "required" && notesBlank);
  const rejectDisabled =
    isPending ||
    (notesPolicy === "requiredOnReject" && notesBlank) ||
    (notesPolicy === "required" && notesBlank);

  // Disarm the inline two-step once a submission settles. Adjusting state during
  // render on a detected prop transition is React's documented alternative to a
  // synchronous setState in an effect: it resolves before the browser paints
  // instead of scheduling a second render pass, which matters here because six
  // admin queues mount this panel.
  const [wasPending, setWasPending] = useState(isPending);
  if (wasPending !== isPending) {
    setWasPending(isPending);
    if (!isPending) setArmedDecision(null);
  }

  function submit(decision: ReviewDecision) {
    if (decision === "approve") onApprove(notes);
    else onReject(notes);
  }

  function handleDecisionClick(decision: ReviewDecision) {
    if (confirmMode === "none") {
      submit(decision);
      return;
    }

    if (confirmMode === "inline-two-step") {
      if (armedDecision === decision) {
        setArmedDecision(null);
        submit(decision);
      } else if (armedDecision !== null) {
        setArmedDecision(null);
      } else {
        setArmedDecision(decision);
      }
      return;
    }

    setDialogDecision(decision);
  }

  function buttonLabel(decision: ReviewDecision) {
    const label = decision === "approve" ? approveLabel : rejectLabel;
    if (confirmMode !== "inline-two-step" || armedDecision !== decision) {
      return label;
    }
    return inlineConfirmLabel?.(decision) ?? `Confirm ${label}`;
  }

  function confirmDialog() {
    if (dialogDecision === null) return;
    const decision = dialogDecision;
    setDialogDecision(null);
    submit(decision);
  }

  const dialogTitle = confirm?.title ?? "Confirm review decision";
  const dialogDescription =
    confirm?.description ?? "Please confirm this review decision.";
  const dialogConfirmLabel =
    dialogDecision === "approve"
      ? confirm?.approveLabel ?? approveLabel
      : confirm?.rejectLabel ?? rejectLabel;

  return (
    <div className="space-y-4">
      {blocker !== undefined && blocker !== null ? (
        <div>{blocker}</div>
      ) : null}

      {notesPolicy !== "none" ? (
        <div className="space-y-2">
          <Label htmlFor={notesId}>{notesLabel}</Label>
          <Textarea
            id={notesId}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={notesPlaceholder}
            aria-required={
              notesPolicy === "required" ||
              notesPolicy === "requiredOnReject"
            }
          />
        </div>
      ) : null}

      <div className="space-y-3">
        {blocker === undefined || blocker === null ? (
          error ? (
            <p className="type-error" role="alert">
              {error}
            </p>
          ) : null
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={approveDisabled}
            onClick={() => handleDecisionClick("approve")}
          >
            {buttonLabel("approve")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={rejectDisabled}
            onClick={() => handleDecisionClick("reject")}
          >
            {buttonLabel("reject")}
          </Button>
          {extraActions}
        </div>
      </div>

      {dialogDecision !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialogDecision(null);
          }}
          title={dialogTitle}
          description={dialogDescription}
          onConfirm={confirmDialog}
          confirmLabel={dialogConfirmLabel}
          confirmText={confirm?.confirmText}
          variant={dialogDecision === "reject" ? "destructive" : "primary"}
          isPending={isPending}
        />
      ) : null}
    </div>
  );
}
