"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { isInteractiveTableTarget } from "@/components/admin/brand-detail-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  ReviewBulkAction,
  ReviewColumn,
  ReviewQueueState,
} from "./types";

export function ReviewQueueTable<T>(props: {
  queue: ReviewQueueState<T>;
  columns: ReviewColumn<T>[];
  emptyMessage: ReactNode;
  getRowName: (item: T) => string;
  selectAllLabel?: string;
  bulkActions?: ReviewBulkAction<T>[];
  rowActions?: (item: T) => ReactNode;
  disclosureControlsId?: (item: T) => string;
  disclosureLabel?: (item: T, expanded: boolean) => string;
  onRowActivate?: (item: T) => void;
  isRowPending?: (item: T) => boolean;
  rowClassName?: (item: T) => string | undefined;
  error?: string | null;
}): React.JSX.Element {
  const {
    queue,
    columns,
    emptyMessage,
    getRowName,
    selectAllLabel = "Select all visible rows",
    bulkActions,
    rowActions,
    disclosureControlsId = (item) => `review-row-${queue.getId(item)}`,
    disclosureLabel = (item, expanded) =>
      `${expanded ? "Hide" : "Show"} details for ${getRowName(item)}`,
    onRowActivate,
    isRowPending,
    rowClassName,
    error,
  } = props;
  const visibleColumns = columns.filter(
    (column) => column.visibleOn?.(queue.activeTab) ?? true,
  );
  const visibleBulkActions = (bulkActions ?? []).filter(
    (action) => action.visibleOn?.(queue.activeTab) ?? true,
  );
  const renderedColumnCount =
    visibleColumns.length +
    (queue.selectionEnabled ? 1 : 0) +
    (rowActions ? 1 : 0) +
    1;

  function activateRow(item: T) {
    if (onRowActivate) onRowActivate(item);
    else queue.toggleOpen(queue.getId(item));
  }

  return (
    <div>
      {bulkActions && bulkActions.length > 0 ? (
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          {visibleBulkActions.map((action) => {
            const eligible = queue.selectedVisible.filter(
              action.eligible ?? (() => true),
            );
            const label = action.label(eligible.length);

            return (
              <Button
                key={action.id}
                type="button"
                variant={action.variant ?? "primary"}
                disabled={
                  eligible.length === 0 ||
                  action.disabled === true ||
                  action.pending === true
                }
                title={action.title}
                aria-label={label}
                onClick={() => action.onRun(eligible)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow className="h-12">
              {queue.selectionEnabled ? (
                <TableHead className="h-12 w-14">
                  <Label className="flex min-h-12 min-w-12 cursor-pointer items-center">
                    <Checkbox
                      aria-label={selectAllLabel}
                      checked={queue.allSelected}
                      indeterminate={queue.someSelected}
                      disabled={queue.selectableVisible.length === 0}
                      onCheckedChange={() => queue.toggleSelectAll()}
                    />
                  </Label>
                </TableHead>
              ) : null}
              {visibleColumns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    "h-12",
                    column.align === "end" && "text-right",
                    column.headClassName,
                  )}
                >
                  {column.srOnlyHeader ? (
                    <span className="sr-only">{column.header}</span>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
              {rowActions ? (
                <TableHead className="h-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
              <TableHead className="h-12">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.visible.map((item) => {
              const id = queue.getId(item);
              const expanded = queue.openId === id;
              const selected = queue.selectedIds.has(id);
              const disclosureId = disclosureControlsId(item);
              const pending = isRowPending?.(item) ?? false;

              return (
                <TableRow
                  key={id}
                  className={cn(
                    "cursor-pointer",
                    rowClassName?.(item),
                  )}
                  data-state={selected ? "selected" : undefined}
                  aria-busy={pending || undefined}
                  onClick={(event) => {
                    if (isInteractiveTableTarget(event.target)) return;
                    if (
                      event.target instanceof Element &&
                      event.target.closest("label")
                    )
                      return;
                    activateRow(item);
                  }}
                >
                  {queue.selectionEnabled ? (
                    <TableCell>
                      <Label className="flex min-h-12 min-w-12 cursor-pointer items-center">
                        <Checkbox
                          aria-label={`Select ${getRowName(item)}`}
                          checked={selected}
                          disabled={!queue.isSelectable(item)}
                          onCheckedChange={() => queue.toggleSelection(id)}
                        />
                      </Label>
                    </TableCell>
                  ) : null}
                  {visibleColumns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        column.align === "end" && "text-right",
                        column.cellClassName,
                      )}
                    >
                      {column.cell(item)}
                    </TableCell>
                  ))}
                  {rowActions ? (
                    <TableCell className="text-right">
                      {rowActions(item)}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Button
                      type="button"
                      shape="pill"
                      variant="ghost"
                      className="h-12 w-12 p-0"
                      onClick={() => activateRow(item)}
                      aria-expanded={expanded}
                      aria-controls={disclosureId}
                      aria-label={disclosureLabel(item, expanded)}
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 transition-transform",
                          expanded && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {queue.visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={renderedColumnCount}
                  className="py-10 text-center type-body-sm"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {error ? (
        <p className="mt-3 type-metadata text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
