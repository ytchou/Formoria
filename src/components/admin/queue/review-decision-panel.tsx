"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ReviewNotesPolicy =
  "none" | "optional" | "requiredOnReject" | "required";

type ReviewDecision = "approve" | "reject";

export function ReviewDecisionPanel(props: {
  onApprove: (notes: string) => void;
  onReject: (notes: string) => void;
  approveLabel?: string;
  rejectLabel?: string;
  notesPolicy?: ReviewNotesPolicy;
  notesLabel?: string;
  notesPlaceholder?: string;
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
    eligible = true,
    blocker,
    isPending = false,
    error,
    extraActions,
  } = props;
  const notesId = useId();
  const [notes, setNotes] = useState("");

  const notesBlank = notes.trim().length === 0;
  const approveDisabled =
    isPending || !eligible || (notesPolicy === "required" && notesBlank);
  const rejectDisabled =
    isPending ||
    (notesPolicy === "requiredOnReject" && notesBlank) ||
    (notesPolicy === "required" && notesBlank);

  function submit(decision: ReviewDecision) {
    if (decision === "approve") onApprove(notes);
    else onReject(notes);
  }

  return (
    <div className="space-y-4">
      {blocker !== undefined && blocker !== null ? <div>{blocker}</div> : null}

      {notesPolicy !== "none" ? (
        <div className="space-y-2">
          <Label htmlFor={notesId}>{notesLabel}</Label>
          <Textarea
            id={notesId}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={notesPlaceholder}
            aria-required={
              notesPolicy === "required" || notesPolicy === "requiredOnReject"
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
            onClick={() => submit("approve")}
          >
            {approveLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={rejectDisabled}
            onClick={() => submit("reject")}
          >
            {rejectLabel}
          </Button>
          {extraActions}
        </div>
      </div>
    </div>
  );
}
