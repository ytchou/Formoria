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
        <h3 className="type-subsection-title">{title}</h3>
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
        <p role="alert" className="type-error">
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

export function DetailValue({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <p className="type-metadata">{label}</p>
      <p className="mt-1 whitespace-pre-wrap type-body">{value}</p>
    </div>
  );
}

export function DetailDefinition({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <dt className="type-metadata">{label}</dt>
      <dd className="mt-1 type-body">{value ?? "—"}</dd>
    </div>
  );
}

export function DetailLinkList({
  title,
  links,
}: {
  title: string;
  links: Array<[string, string]>;
}) {
  return (
    <div>
      <p className="font-semibold type-metadata">{title}</p>
      <ul className="mt-1 space-y-1">
        {links.map(([label, url]) => (
          <li key={`${label}-${url}`}>
            <a
              className="type-link break-all"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DetailStringList({ values }: { values: string[] }) {
  if (values.length === 0) return <p className="type-card-description">—</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 type-body">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}
