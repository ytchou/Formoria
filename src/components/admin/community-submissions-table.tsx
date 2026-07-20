"use client";

import { useId, useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import {
  executeCommunitySubmissionsAction,
  loadCommunitySubmissionsCsvAction,
  previewCommunitySubmissionsAction,
} from "@/app/admin/scripts/bulk-community-submissions/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MAX_COMMUNITY_SUBMISSIONS,
  type CommunitySubmissionDraft,
  type CommunitySubmissionPreview,
  type CommunitySubmissionResult,
} from "@/lib/services/community-submissions";

type EditableRow = CommunitySubmissionDraft & {
  preview?: CommunitySubmissionPreview;
  result?: CommunitySubmissionResult;
  selected: boolean;
};

export function CommunitySubmissionsTable() {
  const idBase = useId();
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateRow(id: string, field: "name" | "website", value: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
              preview: undefined,
              result: undefined,
              selected: false,
            }
          : row,
      ),
    );
    setError(null);
  }

  function removeRow(id: string) {
    const remaining = rows.filter((row) => row.id !== id);
    if (remaining.length === 0) {
      setRows([]);
      return;
    }
    startTransition(async () => {
      await previewDrafts(toDrafts(remaining));
    });
  }

  async function loadCsv(file: File) {
    setError(null);
    try {
      const contents = await file.text();
      startTransition(async () => {
        const result = await loadCommunitySubmissionsCsvAction(contents);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        if (result.rows.length === 0) {
          setError("CSV did not contain any brand entries");
          return;
        }
        if (await previewDrafts(result.rows)) setFileName(file.name);
      });
    } catch {
      setError("Unable to read CSV file");
    }
  }

  async function previewDrafts(drafts: CommunitySubmissionDraft[]) {
    setError(null);
    const result = await previewCommunitySubmissionsAction(drafts);
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    setRows(
      result.rows.map((preview) => ({
        id: preview.id,
        name: preview.normalizedName ?? preview.name,
        website: preview.normalizedWebsite ?? preview.website,
        preview,
        result: undefined,
        selected: preview.status === "ready",
      })),
    );
    return true;
  }

  function repreviewRows() {
    if (rows.length === 0 || rows.every((row) => row.preview)) return;
    startTransition(async () => {
      await previewDrafts(toDrafts(rows));
    });
  }

  function executeRows() {
    const selected = rows.filter((row) => row.selected && isSelectable(row));
    if (selected.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await executeCommunitySubmissionsAction(
        toDrafts(selected),
      );
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const results = new Map(result.results.map((row) => [row.id, row]));
      setRows((current) =>
        current.map((row) => {
          const rowResult = results.get(row.id);
          if (!rowResult) return row;
          return {
            ...row,
            result: rowResult,
            selected: rowResult.status === "failed",
          };
        }),
      );
    });
  }

  const selectedCount = rows.filter(
    (row) => row.selected && isSelectable(row),
  ).length;
  const hasRetry = rows.some(
    (row) => row.selected && row.result?.status === "failed",
  );

  return (
    <div className="space-y-6">
      <SurfaceCard padding="lg">
        <Input
          id={`${idBase}-csv`}
          type="file"
          accept=".csv,text/csv"
          aria-label="Upload CSV"
          className="sr-only"
          disabled={isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void loadCsv(file);
            event.currentTarget.value = "";
          }}
        />
        <Label
          htmlFor={`${idBase}-csv`}
          aria-disabled={isPending}
          className="flex min-h-36 cursor-pointer items-center justify-between gap-6 rounded-lg border border-dashed border-border bg-background p-6 transition-colors hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <span className="flex items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
              <FileUp aria-hidden="true" />
            </span>
            <span className="space-y-1">
              <span className="block type-card-title">
                {isPending ? "Reading and checking CSV…" : "Choose a CSV file"}
              </span>
              <span className="block type-form-hint">
                Rows are checked for duplicates and selected automatically.
              </span>
              {fileName ? (
                <span className="block type-metadata">Loaded: {fileName}</span>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant="outline">name,website</Badge>
            <span className="type-metadata">
              Up to {MAX_COMMUNITY_SUBMISSIONS} rows
            </span>
          </span>
        </Label>
        {error ? (
          <p role="alert" className="mt-4 type-error">
            {error}
          </p>
        ) : null}
      </SurfaceCard>

      {rows.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="type-section-title">Review import</h2>
              <p className="mt-1 type-card-description">
                {rows.length} rows · {selectedCount} selected. Similar matches
                require an explicit selection.
              </p>
            </div>
            <Button
              type="button"
              className="min-h-12"
              disabled={isPending || selectedCount === 0}
              onClick={executeRows}
            >
              {hasRetry
                ? `Retry ${selectedCount} selected`
                : `Import ${selectedCount} selected`}
            </Button>
          </div>
          <SurfaceCard padding="none" className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Import</TableHead>
                  <TableHead>Brand name</TableHead>
                  <TableHead>Official website</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const selectable = isSelectable(row);
                  const checkboxId = `${idBase}-select-${index}`;
                  return (
                    <TableRow
                      key={row.id}
                      data-state={row.selected ? "selected" : undefined}
                    >
                      <TableCell>
                        <Label
                          htmlFor={checkboxId}
                          className="flex min-h-12 min-w-12 cursor-pointer items-center"
                        >
                          <Checkbox
                            id={checkboxId}
                            aria-label={`Select ${row.name || `row ${index + 1}`}`}
                            checked={row.selected}
                            disabled={isPending || !selectable}
                            onCheckedChange={(checked) =>
                              setRows((current) =>
                                current.map((candidate) =>
                                  candidate.id === row.id
                                    ? { ...candidate, selected: checked }
                                    : candidate,
                                ),
                              )
                            }
                          />
                        </Label>
                      </TableCell>
                      <TableCell className="min-w-56">
                        <Input
                          aria-label={`Brand name for row ${index + 1}`}
                          value={row.name}
                          maxLength={200}
                          disabled={isPending || isTerminal(row.result)}
                          onChange={(event) =>
                            updateRow(row.id, "name", event.target.value)
                          }
                          onBlur={repreviewRows}
                        />
                      </TableCell>
                      <TableCell className="min-w-72">
                        <Input
                          aria-label={`Official website for row ${index + 1}`}
                          value={row.website}
                          maxLength={2_000}
                          disabled={isPending || isTerminal(row.result)}
                          onChange={(event) =>
                            updateRow(row.id, "website", event.target.value)
                          }
                          onBlur={repreviewRows}
                        />
                      </TableCell>
                      <TableCell className="min-w-52 whitespace-normal">
                        <RowStatus row={row} />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-12"
                          disabled={isPending}
                          aria-label={`Remove row ${index + 1}`}
                          onClick={() => removeRow(row.id)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </SurfaceCard>
        </div>
      ) : null}
    </div>
  );
}

function RowStatus({ row }: { row: EditableRow }) {
  if (row.result) {
    const config = {
      created: { label: "Done", variant: "success" as const },
      skipped_duplicate: {
        label: "Skipped duplicate",
        variant: "outline" as const,
      },
      failed: { label: "Failed", variant: "destructive" as const },
    }[row.result.status];
    return (
      <div className="space-y-1">
        <Badge variant={config.variant}>{config.label}</Badge>
        {"message" in row.result ? (
          <p className="type-form-hint">{row.result.message}</p>
        ) : null}
      </div>
    );
  }
  if (!row.preview) {
    return (
      <div className="space-y-1">
        <Badge variant="outline">Edited</Badge>
        <p className="type-form-hint">Rechecks when you leave the field.</p>
      </div>
    );
  }
  const config = {
    ready: { label: "Ready", variant: "success" as const },
    similar: { label: "Similar", variant: "secondary" as const },
    duplicate: { label: "Exact duplicate", variant: "destructive" as const },
    invalid: { label: "Invalid", variant: "destructive" as const },
  }[row.preview.status];
  return (
    <div className="space-y-1">
      <Badge variant={config.variant}>{config.label}</Badge>
      {row.preview.message ? (
        <p className="type-form-hint">{row.preview.message}</p>
      ) : null}
    </div>
  );
}

function toDrafts(rows: EditableRow[]): CommunitySubmissionDraft[] {
  return rows.map(({ id, name, website }) => ({ id, name, website }));
}

function isTerminal(result: CommunitySubmissionResult | undefined): boolean {
  return result?.status === "created" || result?.status === "skipped_duplicate";
}

function isSelectable(row: EditableRow): boolean {
  return (
    !isTerminal(row.result) &&
    (row.preview?.status === "ready" || row.preview?.status === "similar")
  );
}
