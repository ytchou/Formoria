"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type DetailSectionProps = {
  title: string;
  canEdit?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  isPending?: boolean;
  /** Save failure for this section. Rendered next to the actions, not offscreen. */
  error?: string | null;
  editLabel: string;
  saveLabel: string;
  cancelLabel: string;
  children: ReactNode;
};

export function DetailSection({
  title,
  canEdit = false,
  editing = false,
  onEdit,
  onSave,
  onCancel,
  isPending = false,
  error = null,
  editLabel,
  saveLabel,
  cancelLabel,
  children,
}: DetailSectionProps) {
  return (
    <section
      className={editing ? "space-y-4 rounded-lg bg-muted/40 p-4" : "space-y-3"}
    >
      <div className="flex items-center justify-between">
        <h3 className="type-body-sm font-semibold text-ink">{title}</h3>
        {canEdit && !editing && (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="min-h-12"
            onClick={onEdit}
          >
            {editLabel}
          </Button>
        )}
      </div>
      {children}
      {editing && error && (
        <p role="alert" className="type-metadata text-danger">
          {error}
        </p>
      )}
      {editing && (
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button
            className="min-h-12"
            variant="secondary"
            onClick={onCancel}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            className="min-h-12"
            variant="primary"
            onClick={onSave}
            disabled={isPending}
          >
            {saveLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
