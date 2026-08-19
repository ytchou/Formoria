"use client";

import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { inkActionClassName } from "@/components/admin/ink-action";
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
  const notesHintId = `${notesId}-hint`;
  const [notes, setNotes] = useState("");

  const notesBlank = notes.trim().length === 0;
  const approveDisabled =
    isPending || !eligible || (notesPolicy === "required" && notesBlank);
  const rejectDisabled =
    isPending ||
    (notesPolicy === "requiredOnReject" && notesBlank) ||
    (notesPolicy === "required" && notesBlank);
  // A disabled control with no stated reason is a dead end for a screen reader.
  // Name the blocker and point the button that it disables at it.
  const notesRequiredHint =
    notesBlank && notesPolicy === "required"
      ? `${notesLabel} are required before deciding.`
      : notesBlank && notesPolicy === "requiredOnReject"
        ? `${notesLabel} are required to reject.`
        : null;

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
            aria-describedby={
              notesRequiredHint === null ? undefined : notesHintId
            }
          />
          {notesRequiredHint === null ? null : (
            <p className="type-metadata" id={notesHintId}>
              {notesRequiredHint}
            </p>
          )}
        </div>
      ) : null}

      <div className="space-y-3">
        {/* The blocker (why this row cannot be decided) and the action error
            (why the last decision failed) are independent: gating the error on
            an absent blocker meant any consumer using the `blocker` slot lost
            EVERY action failure message. */}
        {error ? (
          <p className="type-metadata text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className={inkActionClassName}
            disabled={approveDisabled}
            aria-describedby={
              approveDisabled && notesPolicy === "required" && notesBlank
                ? notesHintId
                : undefined
            }
            onClick={() => submit("approve")}
          >
            {approveLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={rejectDisabled}
            aria-describedby={
              rejectDisabled && notesRequiredHint !== null
                ? notesHintId
                : undefined
            }
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
